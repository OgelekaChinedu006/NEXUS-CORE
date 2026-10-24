import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { NexusDatabase } from '../lib/database.js';
import {
  ACCESS_MODES,
  DEFAULT_ACCESS_MODE,
  allowsAccess,
  getAccessMode,
  normalizeAccessMode,
  setAccessMode,
} from '../lib/access-mode.js';

function memoryDb(t) {
  const db = new NexusDatabase(':memory:');
  t.after(() => db.close());
  return db;
}

test('missing or invalid mode settings default to COVENANT', (t) => {
  const db = memoryDb(t);
  assert.equal(DEFAULT_ACCESS_MODE, ACCESS_MODES.COVENANT);
  assert.equal(getAccessMode(db), 'covenant');
  assert.equal(normalizeAccessMode('VEIL'), 'veil');
  assert.equal(normalizeAccessMode('not-a-mode'), null);
  db.setSetting('access_mode', 'bogus');
  assert.equal(getAccessMode(db), 'covenant');
});

test('allowsAccess matches VEIL, AWAKEN and COVENANT rules', () => {
  assert.equal(allowsAccess('veil', { isOwner: true }), true);
  assert.equal(allowsAccess('veil', { isSudo: true }), false);
  assert.equal(allowsAccess('veil', {}), false);

  assert.equal(allowsAccess('covenant', { isOwner: true }), true);
  assert.equal(allowsAccess('covenant', { isSudo: true }), true);
  assert.equal(allowsAccess('covenant', {}), false);

  assert.equal(allowsAccess('awaken', {}), true);
  assert.equal(allowsAccess('awaken', { isOwner: true, isSudo: true }), true);
  assert.equal(allowsAccess(null, {}), false);
  assert.equal(allowsAccess(null, { isOwner: true }), true);
  assert.equal(allowsAccess(null, { isSudo: true }), true);
});

test('selected mode persists across database close and reopen', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-mode-'));
  const file = path.join(dir, 'nexus.db');
  const first = new NexusDatabase(file);
  assert.equal(getAccessMode(first), 'covenant');
  assert.equal(setAccessMode(first, 'veil'), 'veil');
  first.close();

  const second = new NexusDatabase(file);
  assert.equal(getAccessMode(second), 'veil');
  assert.equal(setAccessMode(second, 'awaken'), 'awaken');
  second.close();

  const third = new NexusDatabase(file);
  assert.equal(getAccessMode(third), 'awaken');
  third.close();
});
