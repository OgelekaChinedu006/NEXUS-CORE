import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ensureStorage, InstanceLock } from '../lib/storage.js';
import { NexusDatabase } from '../lib/database.js';

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-storage-'));
}

test('ensureStorage creates writable database and session directories', () => {
  const root = tempDir();
  const config = {
    dbPath: path.join(root, 'data', 'nexus-core.db'),
    sessionDir: path.join(root, 'data', 'session'),
  };
  const result = ensureStorage(config);
  assert.equal(fs.statSync(result.dbDir).isDirectory(), true);
  assert.equal(fs.statSync(result.sessionDir).isDirectory(), true);
  fs.accessSync(result.sessionDir, fs.constants.W_OK);
});

test('ensureStorage skips directory creation for an in-memory database', () => {
  const root = tempDir();
  const sessionDir = path.join(root, 'session');
  const result = ensureStorage({ dbPath: ':memory:', sessionDir });
  assert.equal(result.dbDir, null);
  assert.equal(fs.statSync(sessionDir).isDirectory(), true);
});

test('InstanceLock allows only one live holder of the same WhatsApp session', () => {
  const dir = tempDir();
  const lockPath = path.join(dir, '.nexus.lock');
  const first = new InstanceLock(lockPath);
  first.acquire();
  assert.equal(fs.readFileSync(lockPath, 'utf8').trim(), String(process.pid));
  const second = new InstanceLock(lockPath);
  assert.throws(() => second.acquire(), (error) => {
    assert.equal(error.code, 'INSTANCE_LOCK');
    assert.match(error.message, /already holds this WhatsApp session/);
    return true;
  });
  first.release();
  const third = new InstanceLock(lockPath);
  third.acquire();
  third.release();
  assert.equal(fs.existsSync(lockPath), false);
});

test('InstanceLock reclaims a stale lock from a dead process', () => {
  const dir = tempDir();
  const lockPath = path.join(dir, '.nexus.lock');
  fs.writeFileSync(lockPath, '99999999\n');
  const lock = new InstanceLock(lockPath);
  lock.acquire();
  assert.equal(fs.readFileSync(lockPath, 'utf8').trim(), String(process.pid));
  lock.release();
});

test('file database close checkpoints WAL and remains idempotent', () => {
  const dir = tempDir();
  const dbPath = path.join(dir, 'nexus-core.db');
  const db = new NexusDatabase(dbPath);
  db.setSetting('prefix', '!');
  assert.equal(db.ping(), true);
  db.close();
  db.close();
  assert.equal(fs.existsSync(dbPath), true);
});
