import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { createHandler } from '../handler/handler.js';
import { NexusDatabase } from '../lib/database.js';
import { createLogger } from '../lib/logger.js';
import { CommandError } from '../lib/helpers.js';
import {
  GLOBAL_RUNE_SCOPE,
  RuneStore,
  describeRuneSetting,
  resolveRuneSetting,
} from '../lib/runes.js';
import {
  applyBotCrushZone,
  applyBotLockdown,
  canCrushRemove,
  classifyCall,
  createJoinTracker,
  crushSignals,
  detectInvite,
  detectLink,
  enforceRuneViolation,
  handleCallRune,
  isExemptFromRunes,
  isStatusMentionOfTarget,
} from '../lib/rune-engine.js';
import { executeRuneCommand } from '../lib/rune-commands.js';
import { loadCommands } from '../lib/registry.js';

const GROUP = '120363000000000000@g.us';
const OTHER_GROUP = '120363111111111111@g.us';
const MEMBER = '111@s.whatsapp.net';
const OTHER = '444@s.whatsapp.net';
const ADMIN = '222@s.whatsapp.net';
const SUDO = '333@s.whatsapp.net';
const BOT = '999@s.whatsapp.net';
const OWNER = 'owner@s.whatsapp.net';
const ALLY = '555@s.whatsapp.net';
const CALLER = '666@s.whatsapp.net';
const logger = createLogger({ level: 'silent' });

function freshDb(t) {
  const db = new NexusDatabase(':memory:');
  t.after(() => db.close());
  return db;
}

function makeConfig(overrides = {}) {
  return {
    prefix: '!',
    ownerJid: OWNER,
    ownerDisplay: 'The Sovereign',
    botName: 'TEST CORE',
    footer: 'POWERED BY TEST CORE',
    version: '1.0.0',
    locale: 'en-GB',
    timezone: 'UTC',
    groupMetadataTtlMs: 1000,
    executionTimeoutMs: 1000,
    rateLimit: { windowMs: 10000, maxCommands: 8, noticeCooldownMs: 1000 },
    security: {
      spamWindowMs: 6000,
      spamThreshold: 7,
      profanityWords: ['badword'],
      actionCooldownMs: 1000,
      maxMentions: 120,
    },
    welcome: {
      defaultText: '{user} entered {group}.',
      defaultGoodbyeText: '{user} left {group}.',
    },
    ...overrides,
  };
}

function makeGroupMeta({ botAdmin = true, extra = [] } = {}) {
  return {
    subject: 'Test Domain',
    desc: 'Obey.',
    size: 4,
    owner: ADMIN,
    participants: [
      { id: MEMBER },
      { id: OTHER },
      { id: ALLY },
      { id: ADMIN, admin: 'superadmin' },
      { id: BOT, admin: botAdmin ? 'admin' : undefined },
      ...extra,
    ],
  };
}

function makeSocket(groupMeta = makeGroupMeta(), { failDelete = false, failKick = false, failReject = false, failBlock = false } = {}) {
  const sent = [];
  const settings = [];
  const memberAdd = [];
  const removed = [];
  const rejected = [];
  const blocked = [];
  return {
    user: { id: BOT },
    sent,
    settings,
    memberAdd,
    removed,
    rejected,
    blocked,
    ev: { on() {}, off() {}, removeAllListeners() {} },
    async sendMessage(jid, content, options = {}) {
      if (content?.delete && failDelete) throw new Error('delete refused');
      sent.push({ jid, content, options });
      return { key: { id: `sent-${sent.length}` } };
    },
    async groupMetadata() {
      return groupMeta;
    },
    async groupParticipantsUpdate(jid, targets, action) {
      if (action === 'remove' && failKick) throw new Error('kick refused');
      if (action === 'remove') removed.push(...targets);
      return [];
    },
    async groupSettingUpdate(jid, setting) {
      settings.push({ jid, setting });
    },
    async groupMemberAddMode(jid, mode) {
      memberAdd.push({ jid, mode });
    },
    async rejectCall(id, from) {
      if (failReject) throw new Error('reject refused');
      rejected.push({ id, from });
    },
    async updateBlockStatus(jid, action) {
      if (failBlock) throw new Error('block refused');
      blocked.push({ jid, action });
    },
  };
}

function makeMessage({
  id = 'MSG1',
  chat = GROUP,
  sender = MEMBER,
  text = 'hello',
  fromMe = false,
  message,
  participantAlt,
  participantPn,
  senderPn,
  messageTimestamp,
} = {}) {
  return {
    key: {
      id,
      remoteJid: chat,
      fromMe,
      ...(sender ? { participant: sender } : {}),
      ...(participantAlt ? { participantAlt } : {}),
      ...(participantPn ? { participantPn } : {}),
      ...(senderPn ? { senderPn } : {}),
    },
    message: message || { conversation: text },
    ...(messageTimestamp != null ? { messageTimestamp } : {}),
  };
}

function makeRegistry() {
  return {
    get: () => null,
    size: 0,
    all: () => [],
    categories: () => [],
  };
}

function createHarness(t, { config = {}, groupMeta, botAdmin = true, socketOptions } = {}) {
  const db = new NexusDatabase(':memory:');
  db.setSetting('access_mode', 'awaken');
  const meta = groupMeta || makeGroupMeta({ botAdmin });
  const socket = makeSocket(meta, socketOptions);
  const handler = createHandler({
    config: makeConfig(config),
    db,
    logger,
    registry: makeRegistry(),
    connection: { state: 'open' },
    services: {},
  });
  handler.attach(socket);
  t.after(() => {
    handler.shutdown();
    db.close();
  });
  return { db, socket, handler, meta };
}

function runeCtx(db, overrides = {}) {
  const replies = [];
  const ctx = {
    prefix: '!',
    args: [],
    argsText: '',
    senderJid: ADMIN,
    botJid: BOT,
    targetJid: null,
    targetJids: [],
    isGroup: true,
    isOwner: false,
    isSudo: false,
    isAdmin: true,
    isBotAdmin: true,
    chatJid: GROUP,
    config: makeConfig(),
    db,
    groupMeta: makeGroupMeta(),
    group: db.ensureGroup(GROUP, 'Test Domain'),
    logger,
    sock: makeSocket(),
    reply: async (text, options = {}) => {
      replies.push({ text, options });
      return { ok: true };
    },
    ...overrides,
  };
  return { ctx, replies };
}

test('rune schema is created on fresh and existing databases without dropping columns', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-runes-'));
  const filePath = path.join(dir, 'nexus-core.db');
  const raw = new Database(filePath);
  raw.exec(`
    CREATE TABLE groups (
      jid TEXT PRIMARY KEY,
      name TEXT,
      antilink INTEGER NOT NULL DEFAULT 0,
      antispam INTEGER NOT NULL DEFAULT 0,
      profanity INTEGER NOT NULL DEFAULT 0,
      max_warnings INTEGER NOT NULL DEFAULT 3,
      member_add_mode TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE warnings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      group_jid TEXT NOT NULL,
      user_jid TEXT NOT NULL,
      reason TEXT NOT NULL,
      issued_by TEXT,
      created_at INTEGER NOT NULL
    );
  `);
  raw.prepare(
    'INSERT INTO groups (jid, name, antilink, antispam, profanity, max_warnings, created_at, updated_at) VALUES (?, ?, 1, 1, 1, 5, 1, 1)',
  ).run(GROUP, 'Legacy');
  raw.prepare(
    'INSERT INTO warnings (group_jid, user_jid, reason, issued_by, created_at) VALUES (?, ?, ?, ?, 1)',
  ).run(GROUP, MEMBER, 'legacy', ADMIN);
  raw.close();

  const db = new NexusDatabase(filePath);
  t.after(() => {
    db.close();
    fs.unlinkSync(filePath);
  });

  const tables = db.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((row) => row.name);
  assert.ok(tables.includes('rune_settings'));
  assert.ok(tables.includes('rune_violations'));
  assert.ok(tables.includes('rune_events'));
  const groupColumns = db.db.prepare('PRAGMA table_info(groups)').all().map((column) => column.name);
  assert.ok(groupColumns.includes('antilink'));
  assert.ok(groupColumns.includes('antispam'));
  assert.ok(groupColumns.includes('profanity'));
  assert.ok(groupColumns.includes('max_warnings'));
  assert.ok(groupColumns.includes('member_add_mode'));
  assert.equal(db.getGroup(GROUP).antilink, 1);
  assert.equal(db.countWarnings(GROUP, MEMBER), 1);
  RuneStore.ensureSchema(db.db);
  assert.equal(db.getGroup(GROUP).antilink, 1);

  const memory = freshDb(t);
  const memoryTables = memory.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((row) => row.name);
  assert.ok(memoryTables.includes('rune_settings'));
});

test('legacy dual-read maps antilink/antispam until an explicit rune setting exists', (t) => {
  const db = freshDb(t);
  db.ensureGroup(GROUP, 'Domain');
  db.updateGroup(GROUP, { antilink: 1, antispam: 0 });
  const link = resolveRuneSetting(db, GROUP, 'link');
  const spam = resolveRuneSetting(db, GROUP, 'spam');
  assert.equal(link.enabled, true);
  assert.equal(link.mode, 'grace');
  assert.equal(link.punishment, 'kick');
  assert.equal(link.source, 'legacy');
  assert.equal(spam.enabled, false);
  assert.equal(spam.source, 'legacy');

  db.runes.setSetting(GROUP, 'link', { enabled: false, mode: 'mercy' });
  const overridden = resolveRuneSetting(db, GROUP, 'link');
  assert.equal(overridden.enabled, false);
  assert.equal(overridden.mode, 'mercy');
  assert.equal(overridden.source, 'rune');
  assert.equal(db.getGroup(GROUP).antilink, 1);
  assert.equal(db.getGroup(GROUP).profanity, 0);
});

test('grace counts independently by rune, user and chat and resets only after successful punishment', async (t) => {
  const db = freshDb(t);
  const sock = makeSocket();
  const meta = makeGroupMeta();
  const opts = {
    db,
    sock,
    logger,
    groupMeta: meta,
    botJid: BOT,
    deleteOffending: false,
  };

  for (let index = 1; index <= 3; index += 1) {
    const result = await enforceRuneViolation({
      ...opts,
      rune: 'link',
      scope: GROUP,
      chatJid: GROUP,
      userJid: MEMBER,
      mode: 'grace',
    });
    assert.equal(result.warned, true);
    assert.equal(result.punished, false);
    assert.equal(result.count, index);
  }
  assert.equal(db.runes.getViolationCount(GROUP, MEMBER, 'spam'), 0);
  assert.equal(db.runes.getViolationCount(GROUP, OTHER, 'link'), 0);
  assert.equal(db.runes.getViolationCount(OTHER_GROUP, MEMBER, 'link'), 0);

  const punished = await enforceRuneViolation({
    ...opts,
    rune: 'link',
    scope: GROUP,
    chatJid: GROUP,
    userJid: MEMBER,
    mode: 'grace',
  });
  assert.equal(punished.punished, true);
  assert.equal(punished.reset, true);
  assert.equal(db.runes.getViolationCount(GROUP, MEMBER, 'link'), 0);
});

test('failed grace punishment retains the count and reports the failure', async (t) => {
  const db = freshDb(t);
  db.runes.incrementViolation(GROUP, MEMBER, 'link');
  db.runes.incrementViolation(GROUP, MEMBER, 'link');
  db.runes.incrementViolation(GROUP, MEMBER, 'link');
  const sock = makeSocket(makeGroupMeta(), { failKick: true });
  const result = await enforceRuneViolation({
    db,
    sock,
    logger,
    rune: 'link',
    scope: GROUP,
    chatJid: GROUP,
    userJid: MEMBER,
    mode: 'grace',
    groupMeta: makeGroupMeta(),
    botJid: BOT,
    deleteOffending: false,
  });
  assert.equal(result.punished, false);
  assert.equal(result.reset, false);
  assert.equal(db.runes.getViolationCount(GROUP, MEMBER, 'link'), 4);
  assert.ok(result.failures.some((entry) => /kick refused|lacks admin/i.test(entry)));
  assert.ok(sock.sent.some((entry) => /FAILED/.test(entry.content.text || '')));
});

test('mercy warns once per user/rune/scope and does not increment grace counts', async (t) => {
  const db = freshDb(t);
  const sock = makeSocket();
  const first = await enforceRuneViolation({
    db,
    sock,
    logger,
    rune: 'link',
    scope: GROUP,
    chatJid: GROUP,
    userJid: MEMBER,
    mode: 'mercy',
    groupMeta: makeGroupMeta(),
    botJid: BOT,
    deleteOffending: false,
  });
  assert.equal(first.warned, true);
  const second = await enforceRuneViolation({
    db,
    sock,
    logger,
    rune: 'link',
    scope: GROUP,
    chatJid: GROUP,
    userJid: MEMBER,
    mode: 'mercy',
    groupMeta: makeGroupMeta(),
    botJid: BOT,
    deleteOffending: false,
  });
  assert.equal(second.alreadyWarned, true);
  assert.equal(second.warned, false);
  assert.equal(db.runes.getViolationCount(GROUP, MEMBER, 'link'), 0);
  const otherRune = await enforceRuneViolation({
    db,
    sock,
    logger,
    rune: 'spam',
    scope: GROUP,
    chatJid: GROUP,
    userJid: MEMBER,
    mode: 'mercy',
    groupMeta: makeGroupMeta(),
    botJid: BOT,
    deleteOffending: false,
  });
  assert.equal(otherRune.warned, true);
});

test('mercy warns without accumulating grace counts and exile punishes without warning', async (t) => {
  const db = freshDb(t);
  const sock = makeSocket();
  const mercy = await enforceRuneViolation({
    db,
    sock,
    logger,
    rune: 'spam',
    scope: GROUP,
    chatJid: GROUP,
    userJid: MEMBER,
    mode: 'mercy',
    groupMeta: makeGroupMeta(),
    botJid: BOT,
    deleteOffending: false,
  });
  assert.equal(mercy.warned, true);
  assert.equal(mercy.punished, false);
  assert.equal(db.runes.getViolationCount(GROUP, MEMBER, 'spam'), 0);

  const exileSock = makeSocket();
  const exile = await enforceRuneViolation({
    db,
    sock: exileSock,
    logger,
    rune: 'spam',
    scope: GROUP,
    chatJid: GROUP,
    userJid: MEMBER,
    mode: 'exile',
    groupMeta: makeGroupMeta(),
    botJid: BOT,
    deleteOffending: false,
  });
  assert.equal(exile.warned, false);
  assert.equal(exile.punished, true);
  assert.deepEqual(exileSock.removed, [MEMBER]);
  assert.ok(!exileSock.sent.some((entry) => /MARKS:/.test(entry.content.text || '')));
});

test('authorized reset is scoped to one rune, user and chat', (t) => {
  const db = freshDb(t);
  db.runes.incrementViolation(GROUP, MEMBER, 'link');
  db.runes.incrementViolation(GROUP, MEMBER, 'spam');
  db.runes.incrementViolation(GROUP, OTHER, 'link');
  db.runes.incrementViolation(OTHER_GROUP, MEMBER, 'link');
  assert.equal(db.runes.resetViolation(GROUP, MEMBER, 'link'), 1);
  assert.equal(db.runes.getViolationCount(GROUP, MEMBER, 'link'), 0);
  assert.equal(db.runes.getViolationCount(GROUP, MEMBER, 'spam'), 1);
  assert.equal(db.runes.getViolationCount(GROUP, OTHER, 'link'), 1);
  assert.equal(db.runes.getViolationCount(OTHER_GROUP, MEMBER, 'link'), 1);
});

test('duplicate rune events are claimed once', (t) => {
  const db = freshDb(t);
  assert.equal(db.runes.claimEvent('call-1', 'call'), true);
  assert.equal(db.runes.claimEvent('call-1', 'call'), false);
  assert.equal(db.runes.claimEvent('call-1', 'mention'), true);
});

test('failed deletions are reported and never claimed as success', async (t) => {
  const db = freshDb(t);
  const sock = makeSocket(makeGroupMeta(), { failDelete: true });
  const msg = makeMessage({ id: 'DEL1' });
  const result = await enforceRuneViolation({
    db,
    sock,
    logger,
    rune: 'link',
    scope: GROUP,
    chatJid: GROUP,
    userJid: MEMBER,
    mode: 'mercy',
    groupMeta: makeGroupMeta(),
    botJid: BOT,
    msg,
  });
  assert.equal(result.deleted, false);
  assert.ok(result.failures.some((entry) => /Delete failed/.test(entry)));
  assert.ok(sock.sent.some((entry) => /Delete failed/.test(entry.content.text || '')));
});

test('owner, sudo, admin and ally are exempt from runes; allies have no moderation powers', () => {
  const meta = makeGroupMeta();
  assert.equal(isExemptFromRunes({ senderJid: OWNER, ownerJid: OWNER, isOwner: true }), true);
  assert.equal(isExemptFromRunes({ senderJid: SUDO, isSudo: true }), true);
  assert.equal(isExemptFromRunes({ senderJid: ADMIN, groupMeta: meta, isAdmin: true }), true);
  assert.equal(isExemptFromRunes({ senderJid: ALLY, isAlly: true }), true);
  assert.equal(isExemptFromRunes({ senderJid: MEMBER, groupMeta: meta }), false);
});

test('protocol and nested status-mention wrappers still protect the owner', () => {
  const protocol = {
    key: { id: 'P1', remoteJid: GROUP, participant: MEMBER },
    message: {
      protocolMessage: {
        type: 'STATUS_MENTION_MESSAGE',
        key: { id: 'PROTO1' },
        contextInfo: {
          remoteJid: 'status@broadcast',
          mentionedJid: [OWNER],
          stanzaId: 'PROTO-STATUS',
        },
      },
    },
  };
  const hit = isStatusMentionOfTarget(protocol, { ownerJid: OWNER, botJid: BOT });
  assert.equal(hit.ok, true);
  assert.equal(hit.eventId, 'PROTO-STATUS');
});

test('status mentions of the owner are detected; ordinary @mentions are not', () => {
  const ordinary = {
    key: { id: 'M1', remoteJid: GROUP, participant: MEMBER },
    message: {
      extendedTextMessage: {
        text: 'hello',
        contextInfo: { mentionedJid: [OWNER] },
      },
    },
  };
  assert.equal(isStatusMentionOfTarget(ordinary, { ownerJid: OWNER, botJid: BOT }).ok, false);

  const statusMention = {
    key: { id: 'S1', remoteJid: GROUP, participant: MEMBER },
    message: {
      futureProofMessage: {
        message: {
          statusMentionMessage: {
            message: {
              extendedTextMessage: {
                text: 'status',
                contextInfo: {
                  remoteJid: 'status@broadcast',
                  mentionedJid: [OWNER],
                  stanzaId: 'STATUS1',
                },
              },
            },
          },
        },
      },
    },
  };
  const hit = isStatusMentionOfTarget(statusMention, { ownerJid: OWNER, botJid: BOT });
  assert.equal(hit.ok, true);
  assert.equal(hit.targetJid, OWNER);
  assert.equal(hit.eventId, 'STATUS1');
});

test('bot lockdown never removes members', async () => {
  const sock = makeSocket();
  const db = { updateGroup() {}, logModeration() {} };
  const result = await applyBotLockdown({ sock, groupJid: GROUP, db, actorJid: BOT, logger });
  assert.equal(result.removed, false);
  assert.deepEqual(sock.removed, []);
  assert.equal(sock.settings[0].setting, 'announcement');
  assert.equal(sock.memberAdd[0].mode, 'admin_add');
});

test('crush zone requires join window plus two signals and validates targets', async () => {
  const now = Date.now();
  const mentions = Array.from({ length: 10 }, (_, index) => `${100 + index}@s.whatsapp.net`);
  const signals = crushSignals({
    text: '!attack',
    mentions,
    message: { groupInviteMessage: { groupJid: GROUP } },
    prefixTimestamps: [now, now + 1, now + 2],
  });
  assert.ok(signals.matched >= 2);
  assert.equal(canCrushRemove({ joinedAt: now - 10_000, now, signals }), true);
  assert.equal(canCrushRemove({ joinedAt: now - 70_000, now, signals }), false);

  const sock = makeSocket();
  const db = {
    isOperator: () => false,
    isAlly: () => false,
    updateGroup() {},
    logModeration() {},
  };
  const protectedResult = await applyBotCrushZone({
    sock,
    db,
    logger,
    groupJid: GROUP,
    groupMeta: makeGroupMeta(),
    botJid: BOT,
    ownerJid: OWNER,
    targetJid: ADMIN,
    actorJid: BOT,
    joinedAt: now,
    signals,
    now,
    removalGuard: new Set(),
  });
  assert.equal(protectedResult.removed, false);

  const removed = await applyBotCrushZone({
    sock,
    db,
    logger,
    groupJid: GROUP,
    groupMeta: makeGroupMeta(),
    botJid: BOT,
    ownerJid: OWNER,
    targetJid: MEMBER,
    actorJid: BOT,
    joinedAt: now,
    signals,
    now,
    removalGuard: new Set(),
  });
  assert.equal(removed.removed, true);
  assert.deepEqual(sock.removed, [MEMBER]);
});

test('call mercy rejects without blocking; grace blocks only on the fourth qualifying call', async (t) => {
  const db = freshDb(t);
  db.runes.setSetting(GLOBAL_RUNE_SCOPE, 'call', { enabled: true, mode: 'mercy' });
  const sock = makeSocket();
  const offer = { id: 'C1', from: CALLER, status: 'offer' };
  const mercy = await handleCallRune({ db, sock, logger, ownerJid: OWNER, botJid: BOT, callEvent: offer });
  assert.equal(mercy.rejected, true);
  assert.equal(mercy.blocked, false);
  assert.deepEqual(sock.blocked, []);
  const duplicate = await handleCallRune({ db, sock, logger, ownerJid: OWNER, botJid: BOT, callEvent: offer });
  assert.equal(duplicate.skipped, true);
  assert.equal(duplicate.reason, 'duplicate');

  db.runes.setSetting(GLOBAL_RUNE_SCOPE, 'call', { enabled: true, mode: 'grace' });
  const graceSock = makeSocket();
  for (let index = 1; index <= 3; index += 1) {
    const result = await handleCallRune({
      db,
      sock: graceSock,
      logger,
      ownerJid: OWNER,
      botJid: BOT,
      callEvent: { id: `G${index}`, from: CALLER, status: 'offer' },
    });
    assert.equal(result.blocked, false);
    assert.equal(result.count, index);
  }
  const fourth = await handleCallRune({
    db,
    sock: graceSock,
    logger,
    ownerJid: OWNER,
    botJid: BOT,
    callEvent: { id: 'G4', from: CALLER, status: 'offer' },
  });
  assert.equal(fourth.blocked, true);
  assert.equal(fourth.warned, false);
  assert.equal(fourth.mode, 'grace');
  assert.deepEqual(graceSock.blocked, [{ jid: CALLER, action: 'block' }]);
  assert.equal(db.runes.getViolationCount(GLOBAL_RUNE_SCOPE, CALLER, 'call'), 0);

  const texts = graceSock.sent.map((entry) => entry.content.text || '');
  assert.equal(texts.filter((text) => /First mark/.test(text)).length, 1);
  assert.equal(texts.filter((text) => /Second mark/.test(text)).length, 1);
  assert.equal(texts.filter((text) => /Third mark/.test(text)).length, 1);
  assert.ok(texts.some((text) => /fourth call is the last/i.test(text)));
});

test('call exile rejects and blocks on the first violation without a preliminary warning', async (t) => {
  const db = freshDb(t);
  db.runes.setSetting(GLOBAL_RUNE_SCOPE, 'call', { enabled: true, mode: 'exile' });
  const sock = makeSocket();
  const result = await handleCallRune({
    db,
    sock,
    logger,
    ownerJid: OWNER,
    botJid: BOT,
    callEvent: { id: 'E1', from: CALLER, status: 'offer' },
  });
  assert.equal(result.skipped, false);
  assert.equal(result.rejected, true);
  assert.equal(result.blocked, true);
  assert.equal(result.warned, false);
  assert.equal(result.mode, 'exile');
  assert.deepEqual(sock.rejected, [{ id: 'E1', from: CALLER }]);
  assert.deepEqual(sock.blocked, [{ jid: CALLER, action: 'block' }]);
  assert.equal(db.runes.getViolationCount(GLOBAL_RUNE_SCOPE, CALLER, 'call'), 0);
  assert.ok(!sock.sent.some((entry) => /MARKS:/.test(entry.content.text || '')));
  assert.ok(!sock.sent.some((entry) => /First mark/.test(entry.content.text || '')));
  assert.ok(sock.sent.some((entry) => /first call is the last/i.test(entry.content.text || '')));

  const duplicate = await handleCallRune({
    db,
    sock,
    logger,
    ownerJid: OWNER,
    botJid: BOT,
    callEvent: { id: 'E1', from: CALLER, status: 'offer' },
  });
  assert.equal(duplicate.skipped, true);
  assert.equal(duplicate.reason, 'duplicate');
  assert.equal(sock.blocked.length, 1);
});

test('call rune counters are independent per caller and isolated from other runes', async (t) => {
  const db = freshDb(t);
  db.runes.setSetting(GLOBAL_RUNE_SCOPE, 'call', { enabled: true, mode: 'grace' });
  db.runes.setSetting(GROUP, 'link', { enabled: true, mode: 'grace' });
  db.runes.incrementViolation(GROUP, CALLER, 'link');
  db.runes.incrementViolation(GROUP, CALLER, 'link');
  db.runes.incrementViolation(GROUP, CALLER, 'link');
  const sock = makeSocket();
  const first = await handleCallRune({
    db,
    sock,
    logger,
    ownerJid: OWNER,
    botJid: BOT,
    callEvent: { id: 'I1', from: CALLER, status: 'offer' },
  });
  assert.equal(first.count, 1);
  assert.equal(first.blocked, false);
  const other = await handleCallRune({
    db,
    sock,
    logger,
    ownerJid: OWNER,
    botJid: BOT,
    callEvent: { id: 'I2', from: OTHER, status: 'offer' },
  });
  assert.equal(other.count, 1);
  assert.equal(other.blocked, false);
  assert.equal(db.runes.getViolationCount(GLOBAL_RUNE_SCOPE, CALLER, 'call'), 1);
  assert.equal(db.runes.getViolationCount(GLOBAL_RUNE_SCOPE, OTHER, 'call'), 1);
  assert.equal(db.runes.getViolationCount(GROUP, CALLER, 'link'), 3);

  for (let index = 2; index <= 4; index += 1) {
    await handleCallRune({
      db,
      sock,
      logger,
      ownerJid: OWNER,
      botJid: BOT,
      callEvent: { id: `I1-${index}`, from: CALLER, status: 'offer' },
    });
  }
  assert.equal(db.runes.getViolationCount(GLOBAL_RUNE_SCOPE, CALLER, 'call'), 0);
  assert.equal(db.runes.getViolationCount(GLOBAL_RUNE_SCOPE, OTHER, 'call'), 1);
  assert.deepEqual(sock.blocked, [{ jid: CALLER, action: 'block' }]);
});

test('call rune uses callerPn for LID identity and does not block in mercy after repeats', async (t) => {
  const db = freshDb(t);
  db.runes.setSetting(GLOBAL_RUNE_SCOPE, 'call', { enabled: true, mode: 'mercy' });
  const sock = makeSocket();
  const lid = '777@lid';
  const first = await handleCallRune({
    db,
    sock,
    logger,
    ownerJid: OWNER,
    botJid: BOT,
    callEvent: { id: 'PN1', from: lid, callerPn: CALLER, status: 'offer' },
  });
  assert.equal(first.rejected, true);
  assert.equal(first.blocked, false);
  assert.equal(first.warned, true);
  const second = await handleCallRune({
    db,
    sock,
    logger,
    ownerJid: OWNER,
    botJid: BOT,
    callEvent: { id: 'PN2', from: lid, callerPn: CALLER, status: 'offer' },
  });
  assert.equal(second.rejected, true);
  assert.equal(second.blocked, false);
  assert.equal(second.warned, false);
  assert.deepEqual(sock.blocked, []);
  assert.equal(db.runes.getViolationCount(GLOBAL_RUNE_SCOPE, CALLER, 'call'), 0);
  assert.equal(db.runes.getViolationCount(GLOBAL_RUNE_SCOPE, lid, 'call'), 0);

  db.runes.setSetting(GLOBAL_RUNE_SCOPE, 'call', { enabled: true, mode: 'exile' });
  const exileSock = makeSocket();
  const exile = await handleCallRune({
    db,
    sock: exileSock,
    logger,
    ownerJid: OWNER,
    botJid: BOT,
    callEvent: { id: 'PN3', from: lid, callerPn: CALLER, status: 'offer' },
  });
  assert.equal(exile.blocked, true);
  assert.equal(exile.warned, false);
  assert.deepEqual(exileSock.blocked, [{ jid: CALLER, action: 'block' }]);
});

test('call rune ignores group calls, owner/sudo callers, and failed reject/block APIs', async (t) => {
  const db = freshDb(t);
  db.runes.setSetting(GLOBAL_RUNE_SCOPE, 'call', { enabled: true, mode: 'grace' });
  db.addOperator(SUDO, OWNER);
  const sock = makeSocket();
  assert.equal(classifyCall({ id: 'X', from: CALLER, status: 'ringing' }).ok, false);
  const group = await handleCallRune({
    db,
    sock,
    logger,
    ownerJid: OWNER,
    botJid: BOT,
    callEvent: { id: 'G', from: CALLER, status: 'offer', isGroup: true },
  });
  assert.equal(group.skipped, true);
  const ownerCall = await handleCallRune({
    db,
    sock,
    logger,
    ownerJid: OWNER,
    botJid: BOT,
    callEvent: { id: 'O', from: OWNER, status: 'offer' },
  });
  assert.equal(ownerCall.skipped, true);
  const sudoCall = await handleCallRune({
    db,
    sock,
    logger,
    ownerJid: OWNER,
    botJid: BOT,
    callEvent: { id: 'S', from: SUDO, status: 'offer' },
  });
  assert.equal(sudoCall.skipped, true);

  const failSock = makeSocket(makeGroupMeta(), { failReject: true, failBlock: true });
  db.runes.incrementViolation(GLOBAL_RUNE_SCOPE, CALLER, 'call');
  db.runes.incrementViolation(GLOBAL_RUNE_SCOPE, CALLER, 'call');
  db.runes.incrementViolation(GLOBAL_RUNE_SCOPE, CALLER, 'call');
  const failed = await handleCallRune({
    db,
    sock: failSock,
    logger,
    ownerJid: OWNER,
    botJid: BOT,
    callEvent: { id: 'F4', from: CALLER, status: 'offer' },
  });
  assert.equal(failed.rejected, false);
  assert.equal(failed.blocked, false);
  assert.ok(failed.failures.length >= 2);
  assert.equal(db.runes.getViolationCount(GLOBAL_RUNE_SCOPE, CALLER, 'call'), 4);

  const exileFailSock = makeSocket(makeGroupMeta(), { failReject: true, failBlock: true });
  db.runes.setSetting(GLOBAL_RUNE_SCOPE, 'call', { enabled: true, mode: 'exile' });
  const exileFailed = await handleCallRune({
    db,
    sock: exileFailSock,
    logger,
    ownerJid: OWNER,
    botJid: BOT,
    callEvent: { id: 'EF1', from: OTHER, status: 'offer' },
  });
  assert.equal(exileFailed.rejected, false);
  assert.equal(exileFailed.blocked, false);
  assert.equal(exileFailed.warned, false);
  assert.ok(exileFailed.failures.some((entry) => /Reject failed/i.test(entry)));
  assert.ok(exileFailed.failures.some((entry) => /Block failed/i.test(entry)));
  assert.deepEqual(exileFailSock.blocked, []);
  assert.equal(db.runes.getViolationCount(GLOBAL_RUNE_SCOPE, OTHER, 'call'), 1);
});

test('spam rune fires once at threshold and does not write generic warnings', async (t) => {
  const { db, socket, handler } = createHarness(t);
  db.ensureGroup(GROUP, 'Test Domain');
  db.runes.setSetting(GROUP, 'spam', { enabled: true, mode: 'grace' });
  for (let index = 1; index <= 7; index += 1) {
    await handler.processMessage(socket, makeMessage({ id: `SP${index}`, text: String(index) }));
  }
  assert.equal(db.runes.getViolationCount(GROUP, MEMBER, 'spam'), 1);
  assert.equal(db.countWarnings(GROUP, MEMBER), 0);
  assert.ok(socket.sent.some((entry) => entry.content.delete?.id === 'SP7'));
  await handler.processMessage(socket, makeMessage({ id: 'SP7', text: 'repeat' }));
  assert.equal(db.runes.getViolationCount(GROUP, MEMBER, 'spam'), 1);
});

test('spam rune counts LID and phone aliases of the same member together', async (t) => {
  const lid = '123456789012345@lid';
  const meta = makeGroupMeta({ extra: [{ id: lid, phoneNumber: MEMBER }] });
  const { db, socket, handler } = createHarness(t, { groupMeta: meta });
  db.ensureGroup(GROUP, 'Test Domain');
  db.runes.setSetting(GROUP, 'spam', { enabled: true, mode: 'grace' });
  for (let index = 1; index <= 4; index += 1) {
    await handler.processMessage(socket, makeMessage({ id: `LID${index}`, sender: lid, text: String(index) }));
  }
  for (let index = 5; index <= 7; index += 1) {
    await handler.processMessage(socket, makeMessage({ id: `PN${index}`, sender: MEMBER, text: String(index) }));
  }
  assert.equal(db.runes.getViolationCount(GROUP, MEMBER, 'spam'), 1);
  assert.equal(db.countWarnings(GROUP, MEMBER), 0);
});

test('handler uses rune path for legacy antilink without writing generic warnings', async (t) => {
  const { db, socket, handler } = createHarness(t);
  db.ensureGroup(GROUP, 'Test Domain');
  db.updateGroup(GROUP, { antilink: 1, max_warnings: 3 });
  await handler.processMessage(socket, makeMessage({ id: 'L1', text: 'https://example.com' }));
  assert.equal(socket.sent[0].content.delete?.id, 'L1');
  assert.equal(db.countWarnings(GROUP, MEMBER), 0);
  assert.equal(db.runes.getViolationCount(GROUP, MEMBER, 'link'), 1);
});

test('admins and allies still bypass rune filters', async (t) => {
  const { db, socket, handler } = createHarness(t);
  db.ensureGroup(GROUP, 'Test Domain');
  db.runes.setSetting(GROUP, 'link', { enabled: true, mode: 'exile' });
  db.addAlly(GROUP, MEMBER, ADMIN);
  await handler.processMessage(socket, makeMessage({ id: 'L2', text: 'https://example.com' }));
  assert.equal(socket.sent.length, 0);
  assert.equal(db.runes.getViolationCount(GROUP, MEMBER, 'link'), 0);
});

test('ordinary group mentions do not trigger mention rune; status mentions do', async (t) => {
  const { db, socket, handler } = createHarness(t);
  db.ensureGroup(GROUP, 'Test Domain');
  db.runes.setSetting(GROUP, 'mention', { enabled: true, mode: 'mercy' });
  await handler.handleUpsert(socket, {
    type: 'notify',
    messages: [
      {
        key: { id: 'ORD1', remoteJid: GROUP, participant: MEMBER },
        message: {
          extendedTextMessage: {
            text: '@owner',
            contextInfo: { mentionedJid: [OWNER] },
          },
        },
      },
    ],
  });
  assert.equal(db.runes.getViolationCount(GROUP, MEMBER, 'mention'), 0);

  await handler.handleUpsert(socket, {
    type: 'append',
    messages: [
      {
        key: { id: 'ST1', remoteJid: GROUP, participant: MEMBER },
        message: {
          statusMentionMessage: {
            message: {
              extendedTextMessage: {
                text: 'mentioned',
                contextInfo: {
                  remoteJid: 'status@broadcast',
                  mentionedJid: [OWNER],
                  stanzaId: 'STATUS-A',
                },
              },
            },
          },
        },
      },
    ],
  });
  assert.ok(socket.sent.some((entry) => /MENTION RUNE/.test(entry.content.text || '')));
});

test('bot rune crush removes only when criteria match and never duplicates', async (t) => {
  const { db, socket, handler } = createHarness(t, { botAdmin: true });
  db.ensureGroup(GROUP, 'Test Domain');
  db.runes.setSetting(GROUP, 'bot', { enabled: true, mode: 'crush' });
  handler.joinTracker.record(GROUP, MEMBER, Date.now());
  const mentions = Array.from({ length: 10 }, (_, index) => `${200 + index}@s.whatsapp.net`);
  const inviteText = 'join https://chat.whatsapp.com/AbCdEfGhIjK';
  await handler.processMessage(
    socket,
    makeMessage({
      id: 'BOT1',
      text: inviteText,
      message: {
        extendedTextMessage: {
          text: inviteText,
          contextInfo: { mentionedJid: mentions },
        },
      },
    }),
  );
  assert.deepEqual(socket.removed, [MEMBER]);
  await handler.processMessage(
    socket,
    makeMessage({
      id: 'BOT2',
      text: inviteText,
      message: {
        extendedTextMessage: {
          text: inviteText,
          contextInfo: { mentionedJid: mentions },
        },
      },
    }),
  );
  assert.deepEqual(socket.removed, [MEMBER]);
});

test('bot rune lockdown command never removes members', async (t) => {
  const db = freshDb(t);
  db.ensureGroup(GROUP, 'Test Domain');
  const sock = makeSocket();
  const { ctx, replies } = runeCtx(db, { sock, args: ['lockdown'] });
  const botrune = (await import('../commands/atlas-rune/botrune.js')).default;
  await botrune.execute(ctx);
  assert.deepEqual(sock.removed, []);
  assert.equal(sock.settings[0].setting, 'announcement');
  assert.match(replies[0].text, /BOT RUNE/);
  assert.equal(describeRuneSetting(resolveRuneSetting(db, GROUP, 'bot')).includes('LOCKDOWN'), true);
});

test('call listener is attached once and mercy never blocks through the handler', async (t) => {
  const { db, socket, handler } = createHarness(t);
  db.runes.setSetting(GLOBAL_RUNE_SCOPE, 'call', { enabled: true, mode: 'mercy' });
  const events = [];
  const live = {
    ...socket,
    ev: {
      on(name, fn) {
        events.push(name);
        live[`_${name}`] = fn;
      },
      off() {},
    },
  };
  handler.attach(live);
  assert.equal(events.filter((name) => name === 'call').length, 1);
  await handler.handleCall(socket, { id: 'H1', from: CALLER, status: 'offer' });
  assert.deepEqual(socket.rejected, [{ id: 'H1', from: CALLER }]);
  assert.deepEqual(socket.blocked, []);
});

test('rune commands require admin in groups and sudo for call rune; reset is scoped', async (t) => {
  const db = freshDb(t);
  db.ensureGroup(GROUP, 'Domain');
  const memberCtx = runeCtx(db, { isAdmin: false, senderJid: MEMBER, args: ['on'] });
  await assert.rejects(() => executeRuneCommand(memberCtx.ctx, 'link'), CommandError);

  const adminCtx = runeCtx(db, { args: ['grace'] });
  await executeRuneCommand(adminCtx.ctx, 'link');
  assert.equal(resolveRuneSetting(db, GROUP, 'link').mode, 'grace');
  assert.equal(resolveRuneSetting(db, GROUP, 'link').enabled, true);

  db.runes.incrementViolation(GROUP, MEMBER, 'link');
  db.runes.incrementViolation(GROUP, OTHER, 'link');
  const resetCtx = runeCtx(db, { args: ['reset'], targetJid: MEMBER });
  await executeRuneCommand(resetCtx.ctx, 'link');
  assert.equal(db.runes.getViolationCount(GROUP, MEMBER, 'link'), 0);
  assert.equal(db.runes.getViolationCount(GROUP, OTHER, 'link'), 1);

  const publicCall = runeCtx(db, { isAdmin: true, isSudo: false, isOwner: false, args: ['on'] });
  await assert.rejects(() => executeRuneCommand(publicCall.ctx, 'call'), /Sovereign|operator/);
  const sudoCall = runeCtx(db, { isSudo: true, args: ['grace'] });
  await executeRuneCommand(sudoCall.ctx, 'call');
  assert.equal(resolveRuneSetting(db, GLOBAL_RUNE_SCOPE, 'call').mode, 'grace');

  const exileCall = runeCtx(db, { isSudo: true, args: ['exile'] });
  await executeRuneCommand(exileCall.ctx, 'call');
  assert.equal(resolveRuneSetting(db, GLOBAL_RUNE_SCOPE, 'call').mode, 'exile');
  assert.equal(resolveRuneSetting(db, GLOBAL_RUNE_SCOPE, 'call').enabled, true);

  const helpCall = runeCtx(db, { isSudo: true, args: ['help'] });
  await executeRuneCommand(helpCall.ctx, 'call');
  const helpText = helpCall.replies[0].text;
  assert.match(helpText, /mercy\|grace\|exile/);
  assert.match(helpText, /Exile blocks immediately/);
  assert.doesNotMatch(helpText, /has no Exile mode/);
});

test('generic profanity warnings and lockdown remain independent of runes', async (t) => {
  const { db, socket, handler } = createHarness(t);
  db.ensureGroup(GROUP, 'Test Domain');
  db.updateGroup(GROUP, { profanity: 1, max_warnings: 3 });
  await handler.processMessage(socket, makeMessage({ id: 'P1', text: 'this is a badword' }));
  assert.equal(db.countWarnings(GROUP, MEMBER), 1);
  assert.equal(db.runes.getViolationCount(GROUP, MEMBER, 'link'), 0);
  assert.ok(socket.sent.some((entry) => /JUDGMENT/.test(entry.content.text || '')));

  const lockdown = (await import('../commands/domain/lockdown.js')).default;
  const { ctx } = runeCtx(db, { sock: socket, args: [] });
  await lockdown.execute(ctx);
  assert.equal(socket.settings.at(-1).setting, 'announcement');
  assert.equal(db.getGroup(GROUP).member_add_mode, 'admin_add');
});

test('link detection covers bare hosts and nested invite payloads', () => {
  assert.equal(detectLink('see wa.me for chat'), true);
  assert.equal(detectLink('join chat.whatsapp.com now'), true);
  assert.equal(detectLink('https://example.com/path'), true);
  assert.equal(detectLink('http://evil.example/path'), true);
  assert.equal(detectLink('visit www.example.org/x now'), true);
  assert.equal(detectLink('no urls here'), false);
  assert.equal(detectLink('mmg.whatsapp.net is not a user link'), false);
  assert.equal(detectInvite({ groupInviteMessage: { groupJid: GROUP } }, ''), true);
  assert.equal(
    detectInvite(
      {
        ephemeralMessage: {
          message: {
            viewOnceMessage: {
              message: { groupInviteMessage: { inviteCode: 'AbCd' } },
            },
          },
        },
      },
      '',
    ),
    true,
  );
  assert.equal(detectLink('', { extendedTextMessage: { text: 'https://evil.example' } }), true);
  assert.equal(detectLink('', { imageMessage: { caption: 'see https://phish.example' } }), true);
  assert.equal(
    detectLink('', { imageMessage: { url: 'https://mmg.whatsapp.net/v/t62/media.jpg', caption: 'photo' } }),
    false,
  );
  assert.equal(
    detectLink('', { imageMessage: { url: 'https://pps.whatsapp.net/v/t61/avatar.jpg', mimetype: 'image/jpeg' } }),
    false,
  );
  assert.equal(detectInvite({}, 'hello'), false);
  assert.equal(
    detectLink('just a reply', {
      extendedTextMessage: {
        text: 'just a reply',
        contextInfo: {
          quotedMessage: { conversation: 'https://quoted.example/should-ignore' },
        },
      },
    }),
    false,
  );
  assert.equal(detectLink('https://mmg.whatsapp.net/v/t62/media.jpg'), false);
  assert.equal(detectLink('https://media.whatsapp.net/v/t62/file.bin'), false);
  assert.equal(detectLink('https://scontent.xx.cdn.whatsapp.net/v/t62/x.jpg'), false);
});

test('linkrune mercy deletes and warns once without escalating', async (t) => {
  const { db, socket, handler } = createHarness(t);
  db.ensureGroup(GROUP, 'Test Domain');
  db.runes.setSetting(GROUP, 'link', { enabled: true, mode: 'mercy', punishment: 'kick' });
  await handler.processMessage(socket, makeMessage({ id: 'LM1', text: 'https://example.com/one' }));
  assert.equal(socket.sent[0].content.delete?.id, 'LM1');
  assert.equal(socket.removed.length, 0);
  assert.equal(db.runes.getViolationCount(GROUP, MEMBER, 'link'), 0);
  assert.ok(socket.sent.some((entry) => /single warning/i.test(entry.content.text || '')));

  await handler.processMessage(socket, makeMessage({ id: 'LM2', text: 'https://example.com/two' }));
  assert.ok(socket.sent.some((entry) => entry.content.delete?.id === 'LM2'));
  assert.equal(socket.removed.length, 0);
  assert.equal(db.runes.getViolationCount(GROUP, MEMBER, 'link'), 0);
  assert.equal(socket.sent.filter((entry) => /single warning/i.test(entry.content.text || '')).length, 1);
});

test('linkrune grace warns three times then applies the configured punishment on the fourth', async (t) => {
  const { db, socket, handler } = createHarness(t);
  db.ensureGroup(GROUP, 'Test Domain');
  db.runes.setSetting(GROUP, 'link', { enabled: true, mode: 'grace', punishment: 'kick' });
  const marks = [];
  for (let index = 1; index <= 3; index += 1) {
    await handler.processMessage(socket, makeMessage({ id: `LG${index}`, text: `https://example.com/${index}` }));
    assert.equal(socket.removed.length, 0);
    assert.equal(db.runes.getViolationCount(GROUP, MEMBER, 'link'), index);
    marks.push(socket.sent.at(-1).content.text || '');
  }
  assert.match(marks[0], /First mark/);
  assert.match(marks[1], /Second mark/);
  assert.match(marks[2], /Third mark/);
  assert.equal(marks.filter((text) => /MARKS: 1\/3/.test(text)).length, 1);
  assert.equal(marks.filter((text) => /MARKS: 2\/3/.test(text)).length, 1);
  assert.equal(marks.filter((text) => /MARKS: 3\/3/.test(text)).length, 1);

  await handler.processMessage(socket, makeMessage({ id: 'LG4', text: 'https://example.com/4' }));
  assert.deepEqual(socket.removed, [MEMBER]);
  assert.equal(db.runes.getViolationCount(GROUP, MEMBER, 'link'), 0);
  assert.ok(socket.sent.some((entry) => /VERDICT: KICK/.test(entry.content.text || '')));
  assert.ok(!socket.sent.some((entry) => /VERDICT: BAN/.test(entry.content.text || '')));
});

test('linkrune exile deletes and applies the configured punishment immediately', async (t) => {
  const { db, socket, handler } = createHarness(t);
  db.ensureGroup(GROUP, 'Test Domain');
  db.runes.setSetting(GROUP, 'link', { enabled: true, mode: 'exile', punishment: 'kick' });
  await handler.processMessage(socket, makeMessage({ id: 'LE1', text: 'www.evil.example/join' }));
  assert.ok(socket.sent.some((entry) => entry.content.delete?.id === 'LE1'));
  assert.deepEqual(socket.removed, [MEMBER]);
  assert.equal(db.runes.getViolationCount(GROUP, MEMBER, 'link'), 0);
  assert.ok(!socket.sent.some((entry) => /First mark|single warning|MARKS:/.test(entry.content.text || '')));
  assert.ok(socket.sent.some((entry) => /VERDICT: KICK/.test(entry.content.text || '')));
});

test('linkrune counters stay independent per user and per rune', async (t) => {
  const { db, socket, handler } = createHarness(t);
  db.ensureGroup(GROUP, 'Test Domain');
  db.runes.setSetting(GROUP, 'link', { enabled: true, mode: 'grace' });
  db.runes.setSetting(GROUP, 'spam', { enabled: true, mode: 'grace' });
  await handler.processMessage(socket, makeMessage({ id: 'LI1', text: 'https://example.com/a' }));
  await handler.processMessage(socket, makeMessage({ id: 'LI2', sender: OTHER, text: 'https://example.com/b' }));
  assert.equal(db.runes.getViolationCount(GROUP, MEMBER, 'link'), 1);
  assert.equal(db.runes.getViolationCount(GROUP, OTHER, 'link'), 1);
  assert.equal(db.runes.getViolationCount(GROUP, MEMBER, 'spam'), 0);
  assert.equal(db.runes.getViolationCount(OTHER_GROUP, MEMBER, 'link'), 0);
});

test('linkrune identity resolution merges LID and phone aliases of the same member', async (t) => {
  const lid = '123456789012345@lid';
  const meta = makeGroupMeta({ extra: [{ id: lid, phoneNumber: MEMBER }] });
  const { db, socket, handler } = createHarness(t, { groupMeta: meta });
  db.ensureGroup(GROUP, 'Test Domain');
  db.runes.setSetting(GROUP, 'link', { enabled: true, mode: 'grace' });
  await handler.processMessage(socket, makeMessage({ id: 'ID1', sender: lid, text: 'https://example.com/lid' }));
  await handler.processMessage(socket, makeMessage({ id: 'ID2', sender: MEMBER, text: 'https://example.com/pn' }));
  const lidCount = db.runes.getViolationCount(GROUP, lid, 'link');
  const phoneCount = db.runes.getViolationCount(GROUP, MEMBER, 'link');
  assert.equal(lidCount + phoneCount, 2);
  assert.ok(lidCount === 0 || phoneCount === 0);
});

test('linkrune reports failed deletion and failed punishment without claiming success', async (t) => {
  const { db, socket, handler } = createHarness(t, { socketOptions: { failDelete: true, failKick: true } });
  db.ensureGroup(GROUP, 'Test Domain');
  db.runes.setSetting(GROUP, 'link', { enabled: true, mode: 'exile', punishment: 'kick' });
  await handler.processMessage(socket, makeMessage({ id: 'LF1', text: 'https://example.com/fail' }));
  assert.deepEqual(socket.removed, []);
  assert.ok(socket.sent.some((entry) => /FAILED/.test(entry.content.text || '')));
  assert.ok(socket.sent.some((entry) => /Delete failed/.test(entry.content.text || '')));
  assert.ok(socket.sent.some((entry) => /Punishment failed/.test(entry.content.text || '')));
  assert.ok(!socket.sent.some((entry) => /VERDICT: KICK/.test(entry.content.text || '')));
});

test('linkrune enforcement uses the configured punishment and refuses unknown kinds', async (t) => {
  const db = freshDb(t);
  const sock = makeSocket();
  const unknown = await enforceRuneViolation({
    db,
    sock,
    logger,
    rune: 'link',
    scope: GROUP,
    chatJid: GROUP,
    userJid: MEMBER,
    mode: 'exile',
    punishment: 'ban',
    groupMeta: makeGroupMeta(),
    botJid: BOT,
    deleteOffending: false,
  });
  assert.equal(unknown.punished, false);
  assert.deepEqual(sock.removed, []);
  assert.ok(unknown.failures.some((entry) => /Unsupported punishment "ban"/.test(entry)));
  assert.ok(sock.sent.some((entry) => /FAILED/.test(entry.content.text || '')));

  const kicked = await enforceRuneViolation({
    db,
    sock,
    logger,
    rune: 'link',
    scope: GROUP,
    chatJid: GROUP,
    userJid: MEMBER,
    mode: 'exile',
    punishment: 'kick',
    groupMeta: makeGroupMeta(),
    botJid: BOT,
    deleteOffending: false,
  });
  assert.equal(kicked.punished, true);
  assert.deepEqual(sock.removed, [MEMBER]);
});

test('linkrune still enforces for ordinary members under covenant and veil', async (t) => {
  for (const mode of ['covenant', 'veil']) {
    const { db, socket, handler } = createHarness(t);
    db.setSetting('access_mode', mode);
    db.ensureGroup(GROUP, 'Test Domain');
    db.runes.setSetting(GROUP, 'link', { enabled: true, mode: 'grace' });
    await handler.handleUpsert(socket, {
      type: 'notify',
      messages: [makeMessage({ id: `AM-${mode}`, text: 'https://example.com/restricted' })],
    });
    assert.ok(socket.sent.some((entry) => entry.content.delete?.id === `AM-${mode}`), mode);
    assert.equal(db.runes.getViolationCount(GROUP, MEMBER, 'link'), 1, mode);
    assert.equal(db.getUser(MEMBER), null, mode);
  }
});

test('linkrune resolves participantAlt, LID and phone identity fields', async (t) => {
  const lid = '123456789012345@lid';
  const meta = makeGroupMeta({ extra: [{ id: lid, phoneNumber: MEMBER }] });
  const { db, socket, handler } = createHarness(t, { groupMeta: meta });
  db.ensureGroup(GROUP, 'Test Domain');
  db.runes.setSetting(GROUP, 'link', { enabled: true, mode: 'grace' });
  await handler.processMessage(
    socket,
    makeMessage({
      id: 'ALT1',
      sender: undefined,
      participantAlt: lid,
      text: 'https://example.com/alt',
    }),
  );
  assert.equal(db.runes.getViolationCount(GROUP, lid, 'link') + db.runes.getViolationCount(GROUP, MEMBER, 'link'), 1);
  assert.ok(socket.sent.some((entry) => entry.content.delete?.id === 'ALT1'));
});

test('linkrune detects command-prefixed URLs, captions, edits and recent appends', async (t) => {
  const { db, socket, handler } = createHarness(t);
  db.ensureGroup(GROUP, 'Test Domain');
  db.runes.setSetting(GROUP, 'link', { enabled: true, mode: 'grace' });

  await handler.processMessage(socket, makeMessage({ id: 'CMDURL', text: '!echo https://example.com/cmd' }));
  assert.equal(db.runes.getViolationCount(GROUP, MEMBER, 'link'), 1);
  assert.ok(socket.sent.some((entry) => entry.content.delete?.id === 'CMDURL'));

  await handler.processMessage(
    socket,
    makeMessage({
      id: 'CAP1',
      sender: OTHER,
      text: '',
      message: { imageMessage: { caption: 'see https://phish.example/x', url: 'https://mmg.whatsapp.net/v/t62/a.jpg' } },
    }),
  );
  assert.equal(db.runes.getViolationCount(GROUP, OTHER, 'link'), 1);

  const originalId = 'EDIT-ORIG';
  await handler.handleUpsert(socket, {
    type: 'notify',
    messages: [{
      key: { id: 'EDIT1', remoteJid: GROUP, participant: MEMBER, fromMe: false },
      message: {
        protocolMessage: {
          type: 'MESSAGE_EDIT',
          key: { id: originalId, remoteJid: GROUP, participant: MEMBER, fromMe: false },
          editedMessage: { conversation: 'https://edited.example/now' },
        },
      },
    }],
  });
  assert.equal(db.runes.getViolationCount(GROUP, MEMBER, 'link'), 2);
  assert.ok(socket.sent.some((entry) => entry.content.delete?.id === originalId));

  await handler.handleUpsert(socket, {
    type: 'append',
    messages: [makeMessage({
      id: 'APP1',
      sender: OTHER,
      text: 'https://example.com/append',
      messageTimestamp: Math.floor(Date.now() / 1000),
    })],
  });
  assert.equal(db.runes.getViolationCount(GROUP, OTHER, 'link'), 2);
  assert.ok(socket.sent.some((entry) => entry.content.delete?.id === 'APP1'));
});

test('linkrune ignores quoted-only links, WhatsApp media URLs, history and duplicate events', async (t) => {
  const { db, socket, handler } = createHarness(t);
  db.ensureGroup(GROUP, 'Test Domain');
  db.runes.setSetting(GROUP, 'link', { enabled: true, mode: 'grace' });

  await handler.processMessage(
    socket,
    makeMessage({
      id: 'Q1',
      text: 'replying',
      message: {
        extendedTextMessage: {
          text: 'replying',
          contextInfo: { quotedMessage: { conversation: 'https://quoted.example/nope' } },
        },
      },
    }),
  );
  assert.equal(db.runes.getViolationCount(GROUP, MEMBER, 'link'), 0);

  await handler.processMessage(
    socket,
    makeMessage({
      id: 'CDN1',
      text: '',
      message: { imageMessage: { url: 'https://pps.whatsapp.net/v/t61/avatar.jpg', mimetype: 'image/jpeg' } },
    }),
  );
  assert.equal(db.runes.getViolationCount(GROUP, MEMBER, 'link'), 0);

  await handler.handleUpsert(socket, {
    type: 'append',
    messages: [makeMessage({ id: 'OLD1', text: 'https://example.com/old', messageTimestamp: 1_000 })],
  });
  assert.equal(db.runes.getViolationCount(GROUP, MEMBER, 'link'), 0);

  const live = makeMessage({ id: 'DUP-LIVE', text: 'https://example.com/dup' });
  await handler.processMessage(socket, live);
  const afterFirst = db.runes.getViolationCount(GROUP, MEMBER, 'link');
  await handler.processMessage(socket, live);
  assert.equal(db.runes.getViolationCount(GROUP, MEMBER, 'link'), afterFirst);
});

test('linkrune command modes, alias, help and admin permission work', async (t) => {
  const db = freshDb(t);
  db.ensureGroup(GROUP, 'Domain');
  const member = runeCtx(db, { isAdmin: false, senderJid: MEMBER, args: ['on'] });
  await assert.rejects(() => executeRuneCommand(member.ctx, 'link'), CommandError);

  for (const mode of ['mercy', 'grace', 'exile']) {
    const admin = runeCtx(db, { args: [mode] });
    await executeRuneCommand(admin.ctx, 'link');
    const setting = resolveRuneSetting(db, GROUP, 'link');
    assert.equal(setting.enabled, true);
    assert.equal(setting.mode, mode);
    assert.equal(setting.punishment, 'kick');
  }

  const help = runeCtx(db, { args: ['help'] });
  await executeRuneCommand(help.ctx, 'link');
  const helpText = help.replies[0].text;
  assert.match(helpText, /mercy\|grace\|exile/);
  assert.match(helpText, /Mercy deletes the link and warns once/);
  assert.match(helpText, /Grace warns on violations 1, 2 and 3/);
  assert.match(helpText, /Exile deletes the link and applies the configured punishment immediately/);

  const loaded = await loadCommands(path.join(path.resolve(import.meta.dirname, '..'), 'commands'), logger);
  const command = loaded.get('linkrune');
  assert.equal(command.aliases.includes('linkward'), true);
  assert.equal(loaded.get('linkward'), command);
  assert.equal(command.permissions.includes('admin'), true);
});

test('call rune does not pretend a LID block succeeded without phone mapping', async (t) => {
  const db = freshDb(t);
  db.runes.setSetting(GLOBAL_RUNE_SCOPE, 'call', { enabled: true, mode: 'grace' });
  db.runes.incrementViolation(GLOBAL_RUNE_SCOPE, '777@lid', 'call');
  db.runes.incrementViolation(GLOBAL_RUNE_SCOPE, '777@lid', 'call');
  db.runes.incrementViolation(GLOBAL_RUNE_SCOPE, '777@lid', 'call');
  const sock = makeSocket();
  const failed = await handleCallRune({
    db,
    sock,
    logger,
    ownerJid: OWNER,
    botJid: BOT,
    callEvent: { id: 'LID4', from: '777@lid', status: 'offer' },
  });
  assert.equal(failed.blocked, false);
  assert.deepEqual(sock.blocked, []);
  assert.ok(failed.failures.some((entry) => /LID-to-phone mapping is unavailable/i.test(entry)));
  assert.equal(db.runes.getViolationCount(GLOBAL_RUNE_SCOPE, '777@lid', 'call'), 4);

  const mappedSock = makeSocket();
  mappedSock.signalRepository = {
    lidMapping: {
      async getPNForLID(lid) {
        assert.equal(this, mappedSock.signalRepository.lidMapping);
        assert.equal(lid, '777@lid');
        return '666@s.whatsapp.net';
      },
    },
  };
  const mapped = await handleCallRune({
    db,
    sock: mappedSock,
    logger,
    ownerJid: OWNER,
    botJid: BOT,
    callEvent: { id: 'LID5', from: '777@lid', status: 'offer' },
  });
  assert.equal(mapped.blocked, true);
  assert.deepEqual(mappedSock.blocked, [{ jid: '666@s.whatsapp.net', action: 'block' }]);
  assert.equal(db.runes.getViolationCount(GLOBAL_RUNE_SCOPE, '777@lid', 'call'), 0);
  assert.equal(db.runes.getViolationCount(GLOBAL_RUNE_SCOPE, '666@s.whatsapp.net', 'call'), 0);

  const mergeDb = freshDb(t);
  mergeDb.runes.setSetting(GLOBAL_RUNE_SCOPE, 'call', { enabled: true, mode: 'grace' });
  const unmappedSock = makeSocket();
  for (let index = 1; index <= 3; index += 1) {
    const result = await handleCallRune({
      db: mergeDb,
      sock: unmappedSock,
      logger,
      ownerJid: OWNER,
      botJid: BOT,
      callEvent: { id: `M${index}`, from: '777@lid', status: 'offer' },
    });
    assert.equal(result.blocked, false);
    assert.equal(result.count, index);
  }
  const mergeSock = makeSocket();
  mergeSock.signalRepository = {
    lidMapping: {
      async getPNForLID() {
        return '666@s.whatsapp.net';
      },
    },
  };
  const merged = await handleCallRune({
    db: mergeDb,
    sock: mergeSock,
    logger,
    ownerJid: OWNER,
    botJid: BOT,
    callEvent: { id: 'M4', from: '777@lid', status: 'offer' },
  });
  assert.equal(merged.blocked, true);
  assert.deepEqual(mergeSock.blocked, [{ jid: '666@s.whatsapp.net', action: 'block' }]);
  assert.equal(mergeDb.runes.getViolationCount(GLOBAL_RUNE_SCOPE, '777@lid', 'call'), 0);
  assert.equal(mergeDb.runes.getViolationCount(GLOBAL_RUNE_SCOPE, '666@s.whatsapp.net', 'call'), 0);
});

test('crush zone skips LID aliases of protected identities', async () => {
  const now = Date.now();
  const signals = crushSignals({
    text: '!attack https://chat.whatsapp.com/AbCdEfGhIjK',
    mentions: Array.from({ length: 10 }, (_, index) => `${100 + index}@s.whatsapp.net`),
    message: { groupInviteMessage: { groupJid: GROUP } },
    prefixTimestamps: [now, now + 1, now + 2],
  });
  const lidOwner = '888888888888888@lid';
  const sock = makeSocket(makeGroupMeta({ extra: [{ id: lidOwner, phoneNumber: OWNER }] }));
  const db = {
    isOperator: () => false,
    isAlly: () => false,
    updateGroup() {},
    logModeration() {},
  };
  const result = await applyBotCrushZone({
    sock,
    db,
    logger,
    groupJid: GROUP,
    groupMeta: makeGroupMeta({ extra: [{ id: lidOwner, phoneNumber: OWNER }] }),
    botJid: BOT,
    ownerJid: OWNER,
    targetJid: lidOwner,
    actorJid: BOT,
    joinedAt: now,
    signals,
    now,
    removalGuard: new Set(),
  });
  assert.equal(result.removed, false);
  assert.deepEqual(sock.removed, []);
});

test('crush zone never removes members during lockdown-only mode', async (t) => {
  const { db, socket, handler } = createHarness(t);
  db.ensureGroup(GROUP, 'Test Domain');
  db.runes.setSetting(GROUP, 'bot', { enabled: true, mode: 'lockdown' });
  handler.joinTracker.record(GROUP, MEMBER, Date.now());
  const mentions = Array.from({ length: 10 }, (_, index) => `${300 + index}@s.whatsapp.net`);
  await handler.processMessage(
    socket,
    makeMessage({
      id: 'LOCK1',
      text: 'join https://chat.whatsapp.com/AbCdEfGhIjK',
      message: {
        extendedTextMessage: {
          text: 'join https://chat.whatsapp.com/AbCdEfGhIjK',
          contextInfo: { mentionedJid: mentions },
        },
      },
    }),
  );
  assert.deepEqual(socket.removed, []);
});

test('rune commands load uniquely through the registry', async () => {
  const loaded = await loadCommands(path.join(path.resolve(import.meta.dirname, '..'), 'commands'), logger);
  const names = loaded.all().map((command) => command.name);
  assert.equal(new Set(names).size, names.length);
  for (const name of ['linkrune', 'mentionrune', 'spamrune', 'botrune', 'callrune']) {
    assert.ok(loaded.get(name), `missing ${name}`);
  }
  assert.equal(loaded.get('linkrune').permissions.includes('admin'), true);
  assert.equal(loaded.get('callrune').permissions.includes('sudo'), true);
});

test('mercy events survive prune and reset clears the mercy mark', (t) => {
  const db = freshDb(t);
  const mercyKey = `mercy:${GROUP}:${MEMBER}`;
  assert.equal(db.runes.claimEvent(mercyKey, 'link', 1), true);
  assert.equal(db.runes.claimEvent('link:ephemeral', 'link', 1), true);
  assert.equal(db.runes.pruneEvents(1, 100), 1);
  assert.equal(db.runes.hasEvent(mercyKey, 'link'), true);
  assert.equal(db.runes.hasEvent('link:ephemeral', 'link'), false);
  assert.equal(db.runes.releaseEvent(mercyKey, 'link'), 1);
  assert.equal(db.runes.hasEvent(mercyKey, 'link'), false);
});

test('join tracker matches LID and phone aliases of the same joiner', () => {
  const tracker = createJoinTracker();
  const now = Date.now();
  const lid = '123456789012345@lid';
  tracker.record(GROUP, [lid, MEMBER], now);
  assert.equal(tracker.get(GROUP, MEMBER), now);
  assert.equal(tracker.get(GROUP, lid), now);
  assert.equal(tracker.get(GROUP, OTHER), null);
});

test('unauthorized users cannot alter mention rune; owner may configure it in DM', async (t) => {
  const db = freshDb(t);
  db.ensureGroup(GROUP, 'Domain');
  const member = runeCtx(db, { isAdmin: false, senderJid: MEMBER, args: ['on'] });
  await assert.rejects(() => executeRuneCommand(member.ctx, 'mention'), CommandError);
  assert.equal(resolveRuneSetting(db, GROUP, 'mention').enabled, false);

  const ownerDm = runeCtx(db, {
    isGroup: false,
    isOwner: true,
    isAdmin: false,
    senderJid: OWNER,
    chatJid: OWNER,
    args: ['mercy'],
  });
  await executeRuneCommand(ownerDm.ctx, 'mention');
  const globalSetting = resolveRuneSetting(db, GLOBAL_RUNE_SCOPE, 'mention');
  assert.equal(globalSetting.enabled, true);
  assert.equal(globalSetting.mode, 'mercy');
  assert.equal(resolveRuneSetting(db, GROUP, 'mention').enabled, false);
});

test('vigil reports rune settings alongside legacy wards', async (t) => {
  const db = freshDb(t);
  db.ensureGroup(GROUP, 'Domain');
  db.updateGroup(GROUP, { antilink: 1, antispam: 0, profanity: 1 });
  db.runes.setSetting(GROUP, 'mention', { enabled: true, mode: 'mercy' });
  const vigil = (await import('../commands/security/vigil.js')).default;
  const { ctx, replies } = runeCtx(db);
  await vigil.execute(ctx);
  const text = replies[0].text;
  assert.match(text, /ANTI-LINK: ACTIVE/);
  assert.match(text, /LINK RUNE:/);
  assert.match(text, /SPAM RUNE:/);
  assert.match(text, /MENTION RUNE: ACTIVE \(MERCY \/ KICK\)/);
  assert.match(text, /BOT RUNE: DORMANT/);
  assert.match(text, /PROFANITY WARD: ACTIVE/);
});
