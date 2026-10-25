import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createConfig, inspectOwnerJid, normalizeOwnerJid } from '../config/config.js';

const OWNER = '447700900123@s.whatsapp.net';

test('inspectOwnerJid accepts a private WhatsApp user JID and strips device suffixes', () => {
  assert.deepEqual(inspectOwnerJid(OWNER), { configured: true, jid: OWNER, reason: null });
  assert.deepEqual(inspectOwnerJid('447700900123:12@s.whatsapp.net'), {
    configured: true,
    jid: OWNER,
    reason: null,
  });
  assert.deepEqual(inspectOwnerJid(' 447700900123@s.whatsapp.net '), {
    configured: true,
    jid: OWNER,
    reason: null,
  });
  assert.deepEqual(inspectOwnerJid('123456789012345@lid'), {
    configured: true,
    jid: '123456789012345@lid',
    reason: null,
  });
});

test('inspectOwnerJid reports missing, malformed, and non-private values without echoing secrets', () => {
  assert.deepEqual(inspectOwnerJid(''), { configured: false, jid: null, reason: 'missing' });
  assert.deepEqual(inspectOwnerJid(null), { configured: false, jid: null, reason: 'missing' });
  assert.deepEqual(inspectOwnerJid('   '), { configured: false, jid: null, reason: 'missing' });
  assert.deepEqual(inspectOwnerJid('not-a-jid'), { configured: true, jid: null, reason: 'malformed' });
  assert.deepEqual(inspectOwnerJid('447700900123'), { configured: true, jid: null, reason: 'malformed' });
  assert.deepEqual(inspectOwnerJid('120363000000000000@g.us'), {
    configured: true,
    jid: null,
    reason: 'not-private',
  });
  assert.deepEqual(inspectOwnerJid('status@broadcast'), {
    configured: true,
    jid: null,
    reason: 'not-private',
  });
  assert.deepEqual(inspectOwnerJid('123@newsletter'), {
    configured: true,
    jid: null,
    reason: 'not-private',
  });
  assert.deepEqual(inspectOwnerJid('bot@example.com'), {
    configured: true,
    jid: null,
    reason: 'unsupported-domain',
  });
  assert.equal(normalizeOwnerJid(OWNER), OWNER);
  assert.equal(normalizeOwnerJid('not-a-jid'), null);
});

test('createConfig stores a normalized owner JID and rejects group or broadcast values', () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const ok = createConfig({ OWNER_JID: '447700900123:7@s.whatsapp.net' });
  assert.equal(ok.ownerJid, OWNER);
  assert.equal(createConfig({ OWNER_JID: '' }).ownerJid, null);
  assert.equal(createConfig({ OWNER_JID: '120363000000000000@g.us' }).ownerJid, null);
  assert.equal(createConfig({ OWNER_JID: 'status@broadcast' }).ownerJid, null);
  assert.equal(ok.instanceLockFile, '.nexus.lock');
  assert.equal(ok.dbPath, path.resolve(root, 'data/nexus-core.db'));
  assert.equal(ok.sessionDir, path.resolve(root, 'data/session'));
});

test('.env.example is a placeholder template and does not contain a live owner JID or API keys', () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const example = fs.readFileSync(path.join(root, '.env.example'), 'utf8');
  assert.match(example, /^OWNER_JID=$/m);
  assert.equal(example.includes('@s.whatsapp.net'), true);
  assert.match(example, /^GROQ_API_KEY=$/m);
  assert.match(example, /^CEREBRAS_API_KEY=$/m);
  assert.match(example, /^UNSPLASH_ACCESS_KEY=$/m);
  assert.equal(/OWNER_JID=\d+@/.test(example), false);
  assert.equal(/API_KEY=.+/.test(example.split('\n').find((line) => line.startsWith('GROQ_API_KEY='))), false);
});

test('createConfig clamps reconnect settings used by the VPS supervisor', () => {
  const config = createConfig({
    RECONNECT_BASE_MS: '100',
    RECONNECT_MAX_MS: '999999',
    RECONNECT_MAX_ATTEMPTS: '0',
  });
  assert.equal(config.reconnect.baseDelayMs, 500);
  assert.equal(config.reconnect.maxDelayMs, 300000);
  assert.equal(config.reconnect.maxAttempts, 1);
});
