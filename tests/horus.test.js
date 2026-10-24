import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { loadCommands } from '../lib/registry.js';
import { createLogger } from '../lib/logger.js';
import { NexusDatabase } from '../lib/database.js';
import { CommandError } from '../lib/helpers.js';
import { createHandler } from '../handler/handler.js';
import {
  HORUS_ERASE_SETTING,
  HORUS_VANISH_SETTING,
  createHorusMonitor,
  extractRevokeFromMessage,
  extractRevokeFromUpdate,
  readHorusState,
  renderHorusMenu,
  renderHorusStatus,
  setHorusJoint,
  setHorusWatch,
} from '../lib/horus.js';

const ROOT = path.resolve(import.meta.dirname, '..');
const logger = createLogger({ level: 'silent' });
const OWNER = 'owner@s.whatsapp.net';
const MEMBER = '111@s.whatsapp.net';
const GROUP = '120363000000000000@g.us';
const BOT = '999@s.whatsapp.net';
const IMAGE = Buffer.from('horus-image');
const VIDEO = Buffer.from('horus-video');

let registryPromise;
function registry() {
  registryPromise ??= loadCommands(path.join(ROOT, 'commands'), logger);
  return registryPromise;
}

function config(overrides = {}) {
  return {
    prefix: '!',
    ownerJid: OWNER,
    ownerDisplay: 'The Sovereign',
    botName: 'TEST CORE',
    locale: 'en-GB',
    timezone: 'UTC',
    ...overrides,
  };
}

function context(overrides = {}) {
  const replies = [];
  const db = overrides.db || new NexusDatabase(':memory:');
  const ctx = {
    prefix: '!',
    args: [],
    argsText: '',
    senderJid: OWNER,
    isOwner: true,
    chatJid: GROUP,
    config: config(),
    db,
    logger,
    reply: async (text) => {
      replies.push(text);
      return { ok: true };
    },
    ...overrides,
    db,
  };
  return { ctx, replies, db };
}

function viewOnceImage(overrides = {}) {
  return {
    viewOnceMessage: {
      message: {
        imageMessage: {
          mimetype: 'image/jpeg',
          caption: 'hidden still',
          ...overrides,
        },
      },
    },
  };
}

function viewOnceVideo() {
  return {
    ephemeralMessage: {
      message: {
        viewOnceMessageV2: {
          message: {
            videoMessage: { mimetype: 'video/mp4', caption: 'hidden motion' },
          },
        },
      },
    },
  };
}

function makeSocket() {
  const sent = [];
  const listeners = new Map();
  return {
    user: { id: BOT },
    sent,
    ev: {
      on(event, fn) {
        listeners.set(event, fn);
      },
      off(event) {
        listeners.delete(event);
      },
    },
    async sendMessage(jid, content) {
      sent.push({ jid, content });
      return { key: { id: `sent-${sent.length}` } };
    },
    async groupMetadata() {
      return {
        subject: 'Test Domain',
        participants: [
          { id: MEMBER },
          { id: OWNER, admin: 'superadmin' },
          { id: BOT, admin: 'admin' },
        ],
      };
    },
    async groupParticipantsUpdate() {
      return [];
    },
    listeners,
  };
}

function makeHandler(t, { accessMode = 'awaken', ownerJid = OWNER } = {}) {
  const db = new NexusDatabase(':memory:');
  if (accessMode) db.setSetting('access_mode', accessMode);
  const socket = makeSocket();
  const handler = createHandler({
    config: {
      prefix: '!',
      ownerJid,
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
      welcome: { defaultText: '{user} entered {group}.', defaultGoodbyeText: '{user} left {group}.' },
    },
    db,
    logger,
    registry: {
      get: () => null,
      size: 0,
      all: () => [],
      categories: () => [],
    },
    connection: { state: 'open' },
    services: {},
  });
  handler.horus.downloadMedia = async () => IMAGE;
  handler.attach(socket);
  t.after(() => {
    handler.shutdown();
    db.close();
  });
  return { db, socket, handler };
}

test('horus is registered once under Sovereign without aliases', async () => {
  const loaded = await registry();
  const command = loaded.get('horus');
  assert.ok(command);
  assert.equal(command.category, 'sovereign');
  assert.deepEqual(command.permissions, ['owner']);
  assert.deepEqual(command.aliases, []);
  assert.equal(loaded.all().filter((entry) => entry.name === 'horus').length, 1);
  assert.notEqual(loaded.get('vv'), command);
  assert.notEqual(loaded.get('vv2'), command);
});

test('menu and status reflect persisted settings and stay ACTIVE while watches are off', async (t) => {
  const loaded = await registry();
  const { ctx, replies, db } = context();
  t.after(() => db.close());

  await loaded.get('horus').execute(ctx);
  assert.match(replies[0], /System Status: ACTIVE/);
  assert.match(replies[0], /Category: Sovereign/);
  assert.match(replies[0], /VANISHING WATCH/);
  assert.match(replies[0], /Status: OFF/);
  assert.match(replies[0], /ERASURE WATCH/);
  assert.match(replies[0], /Destination: Owner DM/);
  assert.match(replies[0], /!horus vanish on/);
  assert.match(replies[0], /!horus status/);
  assert.doesNotMatch(replies[0], /Status: ON/);

  ctx.args = ['status'];
  await loaded.get('horus').execute(ctx);
  assert.match(replies[1], /Vanishing Watch: OFF/);
  assert.match(replies[1], /Erasure Watch: OFF/);
  assert.match(replies[1], /Joint: OFF/);
});

test('individual vanish and erase controls update only their own persisted setting', async (t) => {
  const loaded = await registry();
  const { ctx, replies, db } = context();
  t.after(() => db.close());
  db.setSetting('prefix', '#');

  ctx.args = ['vanish', 'on'];
  await loaded.get('horus').execute(ctx);
  assert.equal(db.getSettingBool(HORUS_VANISH_SETTING, false), true);
  assert.equal(db.getSettingBool(HORUS_ERASE_SETTING, false), false);
  assert.match(replies.at(-1), /Vanishing Watch: ON/);
  assert.match(replies.at(-1), /Status: ON/);
  assert.match(replies.at(-1), /Status: OFF/);

  ctx.args = ['erase', 'on'];
  await loaded.get('horus').execute(ctx);
  assert.equal(db.getSettingBool(HORUS_VANISH_SETTING, false), true);
  assert.equal(db.getSettingBool(HORUS_ERASE_SETTING, false), true);

  ctx.args = ['erase', 'off'];
  await loaded.get('horus').execute(ctx);
  assert.equal(db.getSettingBool(HORUS_VANISH_SETTING, false), true);
  assert.equal(db.getSettingBool(HORUS_ERASE_SETTING, false), false);
  assert.equal(db.getSetting('prefix'), '#');

  ctx.args = ['status'];
  await loaded.get('horus').execute(ctx);
  assert.match(replies.at(-1), /Vanishing Watch: ON/);
  assert.match(replies.at(-1), /Erasure Watch: OFF/);
  assert.match(replies.at(-1), /Joint: PARTIAL/);
});

test('joint on and off update both settings atomically and remain independent afterwards', async (t) => {
  const loaded = await registry();
  const { ctx, db } = context();
  t.after(() => db.close());

  ctx.args = ['joint', 'on'];
  await loaded.get('horus').execute(ctx);
  assert.equal(db.getSettingBool(HORUS_VANISH_SETTING, false), true);
  assert.equal(db.getSettingBool(HORUS_ERASE_SETTING, false), true);

  ctx.args = ['erase', 'off'];
  await loaded.get('horus').execute(ctx);
  assert.equal(db.getSettingBool(HORUS_VANISH_SETTING, false), true);
  assert.equal(db.getSettingBool(HORUS_ERASE_SETTING, false), false);

  ctx.args = ['joint', 'off'];
  await loaded.get('horus').execute(ctx);
  assert.equal(db.getSettingBool(HORUS_VANISH_SETTING, false), false);
  assert.equal(db.getSettingBool(HORUS_ERASE_SETTING, false), false);
});

test('unknown horus syntax is rejected without changing settings', async (t) => {
  const loaded = await registry();
  const { ctx, db } = context();
  t.after(() => db.close());
  await assert.rejects(() => {
    ctx.args = ['vanish'];
    return loaded.get('horus').execute(ctx);
  }, CommandError);
  await assert.rejects(() => {
    ctx.args = ['nope'];
    return loaded.get('horus').execute(ctx);
  }, CommandError);
  assert.equal(db.getSettingBool(HORUS_VANISH_SETTING, false), false);
  assert.equal(db.getSettingBool(HORUS_ERASE_SETTING, false), false);
});

test('settings default off, persist across monitor reconstruction, and malformed values fail closed', (t) => {
  const db = new NexusDatabase(':memory:');
  t.after(() => db.close());
  const cfg = config();
  const first = createHorusMonitor({ db, config: cfg, logger });
  assert.equal(first.state().vanishStored, false);
  assert.equal(first.state().eraseStored, false);

  setHorusWatch(db, HORUS_VANISH_SETTING, true);
  setHorusWatch(db, HORUS_ERASE_SETTING, true);
  const restarted = createHorusMonitor({ db, config: cfg, logger });
  assert.equal(restarted.state().vanishStored, true);
  assert.equal(restarted.state().eraseStored, true);
  assert.equal(restarted.state().joint, true);

  db.setSetting(HORUS_VANISH_SETTING, 'maybe');
  db.deleteSetting(HORUS_ERASE_SETTING);
  const closed = readHorusState(db, cfg);
  assert.equal(closed.vanishStored, false);
  assert.equal(closed.eraseStored, false);
});

test('missing owner configuration is not reported as a working monitor', () => {
  const db = {
    getSettingBool(key) {
      return key === HORUS_VANISH_SETTING || key === HORUS_ERASE_SETTING;
    },
  };
  const state = readHorusState(db, { ownerJid: null });
  assert.equal(state.vanishStored, true);
  assert.equal(state.vanishEffective, false);
  assert.equal(state.eraseEffective, false);
  assert.equal(state.ownerConfigured, false);
  const menu = renderHorusMenu(state);
  assert.match(menu, /System Status: ACTIVE/);
  assert.match(menu, /Status: OFF/);
  assert.match(menu, /Destination: unconfigured/);
  assert.doesNotMatch(menu, /Status: ON/);
  const status = renderHorusStatus(state);
  assert.match(status, /owner JID missing/);
  assert.match(status, /Destination: unconfigured/);
});

test('Vanishing Watch forwards supported media to the owner DM only when enabled', async () => {
  const db = new NexusDatabase(':memory:');
  const sent = [];
  const socket = {
    async sendMessage(jid, content) {
      sent.push({ jid, content });
      return { key: { id: `n-${sent.length}` } };
    },
  };
  const monitor = createHorusMonitor({
    db,
    config: config(),
    logger,
    downloadMedia: async () => IMAGE,
  });

  const msg = {
    key: { id: 'VO1', remoteJid: GROUP, participant: MEMBER, fromMe: false },
    messageTimestamp: 1_700_000_000,
    message: viewOnceImage(),
  };

  monitor.observeUpsert(socket, msg, { chatJid: GROUP, senderJid: MEMBER, fromMe: false });
  await monitor.waitForIdle();
  assert.equal(sent.length, 0);

  setHorusWatch(db, HORUS_VANISH_SETTING, true);
  monitor.observeUpsert(socket, msg, { chatJid: GROUP, senderJid: MEMBER, fromMe: false });
  await monitor.waitForIdle();
  assert.equal(sent.length, 1);
  assert.equal(sent[0].jid, OWNER);
  assert.equal(sent[0].content.image, IMAGE);
  assert.match(sent[0].content.caption, /Vanishing Watch: image/);
  assert.match(sent[0].content.caption, new RegExp(`Origin: ${GROUP}`));
  assert.match(sent[0].content.caption, new RegExp(`Sender: ${MEMBER}`));

  monitor.observeUpsert(socket, msg, { chatJid: GROUP, senderJid: MEMBER, fromMe: false });
  await monitor.waitForIdle();
  assert.equal(sent.length, 1);

  setHorusWatch(db, HORUS_VANISH_SETTING, false);
  monitor.observeUpsert(
    socket,
    { ...msg, key: { ...msg.key, id: 'VO2' }, message: viewOnceVideo() },
    { chatJid: GROUP, senderJid: MEMBER, fromMe: false },
  );
  await monitor.waitForIdle();
  assert.equal(sent.length, 1);
});

test('Vanishing Watch ignores bot outgoing messages and download failures without crashing', async () => {
  const db = new NexusDatabase(':memory:');
  setHorusWatch(db, HORUS_VANISH_SETTING, true);
  const sent = [];
  const socket = {
    async sendMessage(jid, content) {
      sent.push({ jid, content });
      return { key: { id: 'x' } };
    },
  };
  const monitor = createHorusMonitor({
    db,
    config: config(),
    logger,
    downloadMedia: async () => {
      throw new Error('expired');
    },
  });

  monitor.observeUpsert(
    socket,
    {
      key: { id: 'BOT1', remoteJid: GROUP, fromMe: true },
      message: viewOnceImage(),
    },
    { chatJid: GROUP, senderJid: BOT, fromMe: true },
  );
  await monitor.waitForIdle();
  assert.equal(sent.length, 0);

  monitor.observeUpsert(
    socket,
    {
      key: { id: 'BAD1', remoteJid: GROUP, participant: MEMBER, fromMe: false },
      message: viewOnceImage(),
    },
    { chatJid: GROUP, senderJid: MEMBER, fromMe: false },
  );
  await monitor.waitForIdle();
  assert.equal(sent.length, 0);

  monitor.observeUpsert(
    socket,
    {
      key: { id: 'PLAIN', remoteJid: GROUP, participant: MEMBER, fromMe: false },
      message: { conversation: 'hello' },
    },
    { chatJid: GROUP, senderJid: MEMBER, fromMe: false },
  );
  await monitor.waitForIdle();
  assert.equal(sent.length, 0);
});

test('Erasure Watch recovers cached text and skips duplicates and missing originals safely', async () => {
  const db = new NexusDatabase(':memory:');
  const sent = [];
  const socket = {
    async sendMessage(jid, content) {
      sent.push({ jid, content });
      return { key: { id: `e-${sent.length}` } };
    },
  };
  const monitor = createHorusMonitor({ db, config: config(), logger, downloadMedia: async () => VIDEO });
  const original = {
    key: { id: 'TXT1', remoteJid: GROUP, participant: MEMBER, fromMe: false },
    messageTimestamp: 1_700_000_100,
    message: { conversation: 'this will vanish' },
  };

  monitor.observeUpsert(socket, original, { chatJid: GROUP, senderJid: MEMBER, fromMe: false });
  await monitor.handleUpdates(socket, [
    { key: original.key, update: { message: null, messageStubType: 1 } },
  ]);
  assert.equal(sent.length, 0);

  setHorusWatch(db, HORUS_ERASE_SETTING, true);
  monitor.observeUpsert(socket, original, { chatJid: GROUP, senderJid: MEMBER, fromMe: false });
  await monitor.handleUpdates(socket, [
    { key: original.key, update: { message: null, messageStubType: 1 } },
  ]);
  await monitor.waitForIdle();
  assert.equal(sent.length, 1);
  assert.equal(sent[0].jid, OWNER);
  assert.match(sent[0].content.text, /Erasure Watch/);
  assert.match(sent[0].content.text, /this will vanish/);
  assert.match(sent[0].content.text, new RegExp(`Origin: ${GROUP}`));
  assert.match(sent[0].content.text, new RegExp(`Sender: ${MEMBER}`));

  await monitor.handleUpdates(socket, [
    { key: original.key, update: { message: null, messageStubType: 1 } },
  ]);
  await monitor.waitForIdle();
  assert.equal(sent.length, 1);

  await monitor.handleUpdates(socket, [
    { key: { id: 'NEVER', remoteJid: GROUP, participant: MEMBER }, update: { messageStubType: 1 } },
  ]);
  await monitor.waitForIdle();
  assert.equal(sent.length, 2);
  assert.match(sent[1].content.text, /Original content was not cached/);
  assert.doesNotMatch(sent[1].content.text, /this will vanish/);
});

test('Erasure Watch recovers cached media and protocolMessage revokes', async () => {
  const db = new NexusDatabase(':memory:');
  setHorusWatch(db, HORUS_ERASE_SETTING, true);
  const sent = [];
  const socket = {
    async sendMessage(jid, content) {
      sent.push({ jid, content });
      return { key: { id: `m-${sent.length}` } };
    },
  };
  const monitor = createHorusMonitor({
    db,
    config: config(),
    logger,
    downloadMedia: async () => VIDEO,
  });
  const original = {
    key: { id: 'VID1', remoteJid: GROUP, participant: MEMBER, fromMe: false },
    message: { videoMessage: { mimetype: 'video/mp4', caption: 'clip' } },
  };
  monitor.observeUpsert(socket, original, { chatJid: GROUP, senderJid: MEMBER, fromMe: false });
  await monitor.handleUpdates(socket, [
    { key: original.key, update: { messageStubType: 'REVOKE' } },
  ]);
  await monitor.waitForIdle();
  assert.equal(sent[0].jid, OWNER);
  assert.equal(sent[0].content.video, VIDEO);
  assert.match(sent[0].content.caption, /Erasure Watch/);

  const protocol = {
    key: { id: 'DEL2', remoteJid: GROUP, participant: MEMBER, fromMe: false },
    message: {
      protocolMessage: {
        type: 0,
        key: { id: 'MISSING', remoteJid: GROUP, participant: MEMBER },
      },
    },
  };
  monitor.observeUpsert(socket, protocol, { chatJid: GROUP, senderJid: MEMBER, fromMe: false });
  await monitor.waitForIdle();
  assert.ok(sent.some((entry) => /Original content was not cached/.test(entry.content.text || '')));
});

test('Erasure Watch off after joint on does not forward deletions', async () => {
  const db = new NexusDatabase(':memory:');
  setHorusJoint(db, true);
  setHorusWatch(db, HORUS_ERASE_SETTING, false);
  const sent = [];
  const socket = {
    async sendMessage(jid, content) {
      sent.push({ jid, content });
      return {};
    },
  };
  const monitor = createHorusMonitor({ db, config: config(), logger, downloadMedia: async () => IMAGE });
  const original = {
    key: { id: 'KEEP', remoteJid: GROUP, participant: MEMBER, fromMe: false },
    message: { conversation: 'secret' },
  };
  monitor.observeUpsert(socket, original, { chatJid: GROUP, senderJid: MEMBER, fromMe: false });
  await monitor.handleUpdates(socket, [{ key: original.key, update: { messageStubType: 1 } }]);
  await monitor.waitForIdle();
  assert.equal(sent.length, 0);
  assert.equal(db.getSettingBool(HORUS_VANISH_SETTING, false), true);
});

test('revoke extractors read protocolMessage and messages.update without inventing content', () => {
  const fromProtocol = extractRevokeFromMessage({
    key: { remoteJid: GROUP, participant: MEMBER },
    message: {
      ephemeralMessage: {
        message: {
          protocolMessage: { type: 'REVOKE', key: { id: 'ABC', remoteJid: GROUP } },
        },
      },
    },
  });
  assert.equal(fromProtocol.id, 'ABC');
  assert.equal(fromProtocol.chatJid, GROUP);

  const fromUpdate = extractRevokeFromUpdate({
    key: { id: 'ABC', remoteJid: GROUP, participant: MEMBER },
    update: { message: null, messageStubType: 132 },
  });
  assert.equal(fromUpdate.id, 'ABC');
  assert.equal(extractRevokeFromUpdate({ key: { id: 'X', remoteJid: GROUP }, update: { status: 4 } }), null);
});

test('handler owner gate blocks non-owners from changing Horus settings', async (t) => {
  const loaded = await registry();
  const db = new NexusDatabase(':memory:');
  db.setSetting('access_mode', 'awaken');
  const socket = makeSocket();
  const handler = createHandler({
    config: {
      prefix: '!',
      ownerJid: OWNER,
      ownerDisplay: 'The Sovereign',
      botName: 'TEST CORE',
      footer: 'x',
      version: '1.0.0',
      locale: 'en-GB',
      timezone: 'UTC',
      groupMetadataTtlMs: 1000,
      executionTimeoutMs: 1000,
      rateLimit: { windowMs: 10000, maxCommands: 8, noticeCooldownMs: 1000 },
      security: {
        spamWindowMs: 6000,
        spamThreshold: 7,
        profanityWords: [],
        actionCooldownMs: 1000,
        maxMentions: 120,
      },
      welcome: { defaultText: '', defaultGoodbyeText: '' },
    },
    db,
    logger,
    registry: loaded,
    connection: { state: 'open' },
    services: {},
  });
  handler.attach(socket);
  t.after(() => {
    handler.shutdown();
    db.close();
  });

  await handler.processMessage(socket, {
    key: { id: 'H1', remoteJid: GROUP, participant: MEMBER, fromMe: false },
    message: { conversation: '!horus vanish on' },
  });
  assert.match(socket.sent[0].content.text, /AUTHORITY DENIED/);
  assert.equal(db.getSettingBool(HORUS_VANISH_SETTING, false), false);

  await handler.processMessage(socket, {
    key: { id: 'H2', remoteJid: GROUP, participant: OWNER, fromMe: false },
    message: { conversation: '!horus vanish on' },
  });
  assert.equal(db.getSettingBool(HORUS_VANISH_SETTING, false), true);
});

test('handler Vanishing Watch delivers to the owner and does not recapture bot outbound', async (t) => {
  const { db, socket, handler } = makeHandler(t);
  setHorusWatch(db, HORUS_VANISH_SETTING, true);
  handler.horus.downloadMedia = async () => IMAGE;

  await handler.processMessage(socket, {
    key: { id: '3EB0BOTOUT', remoteJid: GROUP, fromMe: true },
    message: viewOnceImage(),
  });
  await handler.horus.waitForIdle();
  assert.equal(socket.sent.length, 0);

  await handler.processMessage(socket, {
    key: { id: 'VOCHAT', remoteJid: GROUP, participant: MEMBER, fromMe: false },
    messageTimestamp: 1_700_000_200,
    message: viewOnceImage(),
  });
  await handler.horus.waitForIdle();
  const ownerMail = socket.sent.filter((entry) => entry.jid === OWNER);
  assert.equal(ownerMail.length, 1);
  assert.equal(ownerMail[0].content.image, IMAGE);
  assert.equal(socket.sent.some((entry) => entry.jid === GROUP && entry.content.image), false);
});

test('manual vv remains independent of Horus settings', async (t) => {
  const loaded = await registry();
  const db = new NexusDatabase(':memory:');
  t.after(() => db.close());
  setHorusWatch(db, HORUS_VANISH_SETTING, false);
  const contents = [];
  const replies = [];
  const ctx = {
    db,
    config: config(),
    quoted: { message: viewOnceImage(), participant: MEMBER },
    chatJid: GROUP,
    isGroup: true,
    logger,
    downloadViewOnce: async () => IMAGE,
    replyContent: async (content) => {
      contents.push(content);
      return { ok: true };
    },
    reply: async (text) => {
      replies.push(text);
      return { ok: true };
    },
  };
  await loaded.get('vv').execute(ctx);
  assert.equal(contents.length, 1);
  assert.equal(replies[0], 'Nothing stays hidden before the King.');
});
