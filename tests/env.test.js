import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createConfig } from '../config/config.js';
import {
  applyKnownIdentity,
  EnvInitError,
  initializeEnv,
  loadEnv,
  pairingDigits,
  resolveProjectRoot,
} from '../lib/env.js';

const OWNER = '447700900123@s.whatsapp.net';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EXAMPLE = fs.readFileSync(path.join(ROOT, '.env.example'), 'utf8');

function tempRoot() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-env-'));
  fs.writeFileSync(path.join(dir, '.env.example'), EXAMPLE);
  return dir;
}

test('missing .env is created from .env.example with template contents preserved', () => {
  const root = tempRoot();
  const result = initializeEnv({ rootDir: root, source: {} });
  assert.equal(result.created, true);
  const created = fs.readFileSync(result.path, 'utf8');
  assert.equal(created, EXAMPLE);
  assert.match(created, /^OWNER_JID=$/m);
  assert.match(created, /^PAIRING_NUMBER=$/m);
  assert.match(created, /^GROQ_API_KEY=$/m);
  assert.equal(created.includes('sk-'), false);
});

test('existing .env is never replaced or rewritten', () => {
  const root = tempRoot();
  const envPath = path.join(root, '.env');
  const original = 'OWNER_JID=111@s.whatsapp.net\nPAIRING_NUMBER=111\nGROQ_API_KEY=keep-me\n';
  fs.writeFileSync(envPath, original);
  const before = fs.statSync(envPath);
  const result = initializeEnv({
    rootDir: root,
    source: { OWNER_JID: OWNER, PAIRING_NUMBER: '447700900123' },
  });
  assert.equal(result.created, false);
  assert.equal(fs.readFileSync(envPath, 'utf8'), original);
  const after = fs.statSync(envPath);
  assert.equal(after.mtimeMs, before.mtimeMs);
  assert.equal(after.size, before.size);
});

test('known owner and pairing values fill empty template slots without inventing numbers', () => {
  const filled = applyKnownIdentity(EXAMPLE, {
    OWNER_JID: '447700900123:12@s.whatsapp.net',
    PAIRING_NUMBER: '+44 7700 900123',
  });
  assert.match(filled, /^OWNER_JID=447700900123@s.whatsapp.net$/m);
  assert.match(filled, /^PAIRING_NUMBER=447700900123$/m);
  assert.match(filled, /^AUTH_METHOD=qr$/m);
  assert.match(filled, /^GROQ_API_KEY=$/m);

  const empty = applyKnownIdentity(EXAMPLE, {});
  assert.equal(empty, EXAMPLE);
  assert.equal(pairingDigits('+44-7700-900123'), '447700900123');
  assert.equal(pairingDigits(''), '');
});

test('invalid or missing identity sources leave template owner and pairing empty', () => {
  for (const source of [
    { OWNER_JID: 'not-a-jid', PAIRING_NUMBER: 'abc' },
    { OWNER_JID: '120363000000000000@g.us', PAIRING_NUMBER: '' },
    { OWNER_JID: 'status@broadcast' },
    {},
  ]) {
    const next = applyKnownIdentity(EXAMPLE, source);
    assert.match(next, /^OWNER_JID=$/m);
    assert.match(next, /^PAIRING_NUMBER=$/m);
  }
});

test('creating .env inserts available owner and pairing values only into empty template keys', () => {
  const root = tempRoot();
  const result = initializeEnv({
    rootDir: root,
    source: { OWNER_JID: OWNER, PAIRING_NUMBER: '447700900123' },
  });
  const created = fs.readFileSync(result.path, 'utf8');
  assert.match(created, /^OWNER_JID=447700900123@s.whatsapp.net$/m);
  assert.match(created, /^PAIRING_NUMBER=447700900123$/m);
  assert.match(created, /^AUTH_METHOD=qr$/m);
  assert.equal(created.includes('GROQ_API_KEY=gsk_'), false);
});

test('missing .env.example stops with a clear error and does not create .env', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-env-missing-'));
  assert.throws(
    () => initializeEnv({ rootDir: root, source: {} }),
    (error) => {
      assert.equal(error instanceof EnvInitError, true);
      assert.equal(error.code, 'MISSING_EXAMPLE');
      assert.match(error.message, /\.env\.example/);
      assert.match(error.message, /Restore the template/);
      return true;
    },
  );
  assert.equal(fs.existsSync(path.join(root, '.env')), false);
});

test('file-operation failures produce a safe, actionable error', () => {
  const root = tempRoot();
  const fsImpl = {
    constants: fs.constants,
    accessSync() {
      const error = new Error('missing');
      error.code = 'ENOENT';
      throw error;
    },
    readFileSync: fs.readFileSync.bind(fs),
    openSync() {
      const error = new Error('read-only filesystem');
      error.code = 'EROFS';
      throw error;
    },
    writeSync() {
      throw new Error('should not write');
    },
    closeSync() {},
    unlinkSync() {},
  };
  assert.throws(
    () => initializeEnv({ rootDir: root, source: {}, fsImpl }),
    (error) => {
      assert.equal(error instanceof EnvInitError, true);
      assert.match(error.message, /Failed to create \.env/);
      assert.match(error.message, /writable/);
      assert.equal(error.message.includes('gsk_'), false);
      return true;
    },
  );
});

test('loadEnv runs before createConfig and does not override existing process env values', () => {
  const root = tempRoot();
  const previousOwner = process.env.OWNER_JID;
  const previousPrefix = process.env.PREFIX;
  process.env.PREFIX = '#';
  delete process.env.OWNER_JID;
  try {
    const result = loadEnv({ rootDir: root, source: { OWNER_JID: OWNER } });
    assert.equal(result.created, true);
    assert.equal(process.env.PREFIX, '#');
    assert.equal(process.env.OWNER_JID, OWNER);
    const config = createConfig(process.env);
    assert.equal(config.ownerJid, OWNER);
    assert.equal(config.prefix, '#');
  } finally {
    if (previousOwner === undefined) delete process.env.OWNER_JID;
    else process.env.OWNER_JID = previousOwner;
    if (previousPrefix === undefined) delete process.env.PREFIX;
    else process.env.PREFIX = previousPrefix;
  }
});

test('index.js initializes .env before configuration and WhatsApp connection', () => {
  const source = fs.readFileSync(path.join(ROOT, 'index.js'), 'utf8');
  assert.equal(source.includes("import 'dotenv/config'"), false);
  const loadAt = source.indexOf('loadEnv()');
  const configAt = source.indexOf('createConfig(process.env)');
  const startAt = source.indexOf('connection.start()');
  assert.ok(loadAt > 0);
  assert.ok(configAt > loadAt);
  assert.ok(startAt > configAt);
});

test('project root is resolved from the module location, not the working directory', () => {
  const resolved = resolveProjectRoot(pathToFileURL(path.join(ROOT, 'lib/env.js')).href);
  assert.equal(resolved, ROOT);
});

test('.gitignore keeps private .env, sessions, and databases out of git', () => {
  const gitignore = fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8');
  assert.match(gitignore, /^\.env$/m);
  assert.match(gitignore, /^!\.env\.example$/m);
  assert.match(gitignore, /data\/session/);
  assert.match(gitignore, /\*\.db/);
});
