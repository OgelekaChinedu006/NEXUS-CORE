import test from 'node:test';
import assert from 'node:assert/strict';
import { NexusDatabase } from '../lib/database.js';

const GROUP = '120363000000000000@g.us';
const USER = '111@s.whatsapp.net';
const OTHER = '222@s.whatsapp.net';

function freshDb(t) {
  const db = new NexusDatabase(':memory:');
  t.after(() => db.close());
  return db;
}

test('settings persist typed booleans and delete cleanly', (t) => {
  const db = freshDb(t);
  assert.equal(db.getSetting('prefix', '!'), '!');
  assert.equal(db.getSettingBool('absence_enabled', false), false);
  db.setSetting('prefix', '#');
  db.setSetting('absence_enabled', '1');
  assert.equal(db.getSetting('prefix'), '#');
  assert.equal(db.getSettingBool('absence_enabled'), true);
  assert.equal(db.deleteSetting('absence_enabled'), 1);
  assert.equal(db.getSettingBool('absence_enabled', false), false);
});

test('groups are created once, updated only through allowed fields and renamed', (t) => {
  const db = freshDb(t);
  const group = db.ensureGroup(GROUP, 'First Name');
  assert.equal(group.name, 'First Name');
  assert.equal(group.welcome_enabled, 0);
  db.ensureGroup(GROUP, 'Second Name');
  assert.equal(db.getGroup(GROUP).name, 'Second Name');

  db.updateGroup(GROUP, {
    welcome_enabled: 1,
    welcome_text: 'hello {user}',
    max_warnings: 5,
    not_a_column: 'ignored',
  });
  const updated = db.getGroup(GROUP);
  assert.equal(updated.welcome_enabled, 1);
  assert.equal(updated.welcome_text, 'hello {user}');
  assert.equal(updated.max_warnings, 5);
  assert.equal(updated.not_a_column, undefined);
  assert.equal(db.listGroups().length, 1);
});

test('warnings are counted, listed and cleared per group and user', (t) => {
  const db = freshDb(t);
  assert.equal(db.addWarning(GROUP, USER, 'first', 'admin@s.whatsapp.net'), 1);
  assert.equal(db.addWarning(GROUP, USER, 'second', 'admin@s.whatsapp.net'), 2);
  db.addWarning(GROUP, OTHER, 'other', 'admin@s.whatsapp.net');
  assert.equal(db.countWarnings(GROUP, USER), 2);
  assert.equal(db.listWarnings(GROUP, USER).length, 2);
  assert.equal(db.listWarnings(GROUP).length, 3);
  assert.equal(db.getUserStats(USER).warnings, 2);
  assert.equal(db.clearWarnings(GROUP, USER), 2);
  assert.equal(db.countWarnings(GROUP, USER), 0);
  assert.equal(db.clearWarnings(GROUP), 1);
  assert.equal(db.listWarnings(GROUP).length, 0);
});

test('moderation records can be written, listed and purged', (t) => {
  const db = freshDb(t);
  db.logModeration(GROUP, 'warn', USER, 'admin@s.whatsapp.net', 'test');
  db.logModeration(GROUP, 'kick', OTHER, 'admin@s.whatsapp.net');
  assert.equal(db.listModeration(GROUP).length, 2);
  assert.equal(db.clearModeration(GROUP), 2);
  assert.equal(db.listModeration(GROUP).length, 0);
});

test('operators, global bans, group bans and allies are idempotent', (t) => {
  const db = freshDb(t);
  assert.equal(db.addOperator(USER, 'owner@s.whatsapp.net'), true);
  assert.equal(db.addOperator(USER, 'owner@s.whatsapp.net'), true);
  assert.equal(db.isOperator(USER), true);
  assert.equal(db.listOperators().length, 1);
  assert.equal(db.removeOperator(USER), 1);
  assert.equal(db.isOperator(USER), false);

  db.banGlobal(USER, 'reason', 'owner@s.whatsapp.net');
  db.banGlobal(USER, 'new reason', 'owner@s.whatsapp.net');
  assert.equal(db.isGloballyBanned(USER), true);
  assert.equal(db.listGlobalBans().length, 1);
  assert.equal(db.unbanGlobal(USER), 1);

  db.banFromGroup(GROUP, USER, 'reason', 'admin@s.whatsapp.net');
  assert.equal(db.isBannedFromGroup(GROUP, USER), true);
  assert.equal(db.unbanFromGroup(GROUP, USER), 1);
  assert.equal(db.isBannedFromGroup(GROUP, USER), false);

  db.addAlly(GROUP, USER, 'admin@s.whatsapp.net');
  db.addAlly(GROUP, USER, 'admin@s.whatsapp.net');
  assert.equal(db.isAlly(GROUP, USER), true);
  assert.equal(db.listAllies(GROUP).length, 1);
  assert.equal(db.removeAlly(GROUP, USER), 1);
});

test('activity records aggregate messages and commands for users and groups', (t) => {
  const db = freshDb(t);
  db.recordActivity(USER, { groupJid: GROUP });
  db.recordActivity(USER, { groupJid: GROUP });
  db.recordActivity(USER, { groupJid: GROUP, isCommand: true });
  const stats = db.getUserStats(USER);
  assert.equal(stats.messages, 2);
  assert.equal(stats.commands, 1);
  assert.ok(stats.firstSeen);
  assert.ok(stats.lastSeen);
  const activity = db.getGroupActivity(GROUP);
  assert.equal(activity[0].messages, 2);
  assert.equal(activity[0].commands, 1);
});

test('economy claims respect cooldowns and never go below zero', (t) => {
  const db = freshDb(t);
  const first = db.claimEconomy(USER, 'last_daily', 60, 100, 1000);
  assert.equal(first.claimed, true);
  assert.equal(first.balance, 100);
  const second = db.claimEconomy(USER, 'last_daily', 60, 100, 1010);
  assert.equal(second.claimed, false);
  assert.equal(second.balance, 100);

  assert.equal(db.debitBalance(USER, 40), true);
  assert.equal(db.getEconomy(USER).balance, 60);
  assert.equal(db.debitBalance(USER, 1000), false);
  assert.equal(db.getEconomy(USER).balance, 60);
  assert.equal(db.creditBalance(USER, 10), 70);
  assert.equal(db.debitBalance(USER, -50), true);
  assert.equal(db.getEconomy(USER).balance, 70);

  const stats = db.economyStats();
  assert.equal(stats.accounts, 1);
  assert.equal(stats.total, 70);
  assert.equal(db.topBalances()[0].user_jid, USER);
});

test('transfers are atomic and reject self-transfer or insufficient balance', (t) => {
  const db = freshDb(t);
  db.creditBalance(USER, 100);
  assert.equal(db.transferBalance(USER, USER, 10), false);
  assert.equal(db.transferBalance(USER, OTHER, 1000), false);
  assert.equal(db.getEconomy(USER).balance, 100);
  assert.equal(db.transferBalance(USER, OTHER, 75), true);
  assert.equal(db.getEconomy(USER).balance, 25);
  assert.equal(db.getEconomy(OTHER).balance, 75);
});

test('message deduplication and pruning behave predictably', (t) => {
  const db = freshDb(t);
  assert.equal(db.claimMessage('ABC', GROUP), true);
  assert.equal(db.claimMessage('ABC', GROUP), false);
  assert.equal(db.claimMessage('DEF', GROUP), true);
  assert.equal(db.pruneProcessedMessages(0, Math.floor(Date.now() / 1000) + 10), 2);
});

test('stats and audit records reflect the current database', (t) => {
  const db = freshDb(t);
  db.ensureGroup(GROUP, 'Domain');
  db.recordActivity(USER, { groupJid: GROUP, isCommand: true });
  db.addWarning(GROUP, USER, 'reason', 'admin@s.whatsapp.net');
  db.addOperator(OTHER, 'owner@s.whatsapp.net');
  const stats = db.stats();
  assert.equal(stats.groups, 1);
  assert.equal(stats.users, 1);
  assert.equal(stats.messages, 0);
  assert.equal(stats.commands, 1);
  assert.equal(stats.warnings, 1);
  assert.equal(stats.operators, 1);
  db.logAudit('owner@s.whatsapp.net', 'test', USER, 'details');
});
