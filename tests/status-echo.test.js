import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { loadCommands } from '../lib/registry.js';
import { createLogger } from '../lib/logger.js';
import { CommandError } from '../lib/helpers.js';
import { createHandler } from '../handler/handler.js';
import { NexusDatabase } from '../lib/database.js';
import { DELIVERY_FAILED, OWNER_MISSING, VV_SUCCESS_MESSAGE } from '../lib/view-once.js';
import {
  DEFAULT_STATUS_CACHE_LIMIT,
  ECHO_MISSING_MEDIA,
  ECHO_NOT_STATUS,
  ECHO_UNAVAILABLE,
  ECHO_USAGE,
  STATUS_BROADCAST_JID,
  createStatusCache,
  inspectStatusMessage,
  isStatusBroadcastJid,
  observeStatusMessage,
  parseEchoMode,
  recoverViewedStatus,
  resolveRelevantStatus,
  statusRevealCaption,
  toStatusSendContent,
} from '../lib/status-echo.js';

const ROOT = path.resolve(import.meta.dirname, '..');
const logger = createLogger({ level: 'silent' });
const OWNER = 'owner@s.whatsapp.net';
const GROUP = '120363000000000000@g.us';
const AUTHOR = 'author@s.whatsapp.net';
const MEMBER = '111@s.whatsapp.net';
const BOT = '999@s.whatsapp.net';
const IMAGE = Buffer.from('status-image');
const VIDEO = Buffer.from('status-video');
const AUDIO = Buffer.from('status-audio');

let registryPromise;
function registry() {
  registryPromise ??= loadCommands(path.join(ROOT, 'commands'), logger);
  return registryPromise;
}

function statusImage(overrides = {}) {
  return {
    imageMessage: {
      mimetype: 'image/jpeg',
      caption: 'status still',
      mediaKey: Buffer.from('key'),
      directPath: '/status/image',
      url: 'https://mmg.whatsapp.net/status.jpg',
      ...overrides,
    },
  };
}

function statusVideo(overrides = {}) {
  return {
    videoMessage: {
      mimetype: 'video/mp4',
      caption: 'status motion',
      mediaKey: Buffer.from('key'),
      directPath: '/status/video',
      ...overrides,
    },
  };
}

function statusAudio({ ptt = false, ...overrides } = {}) {
  return {
    audioMessage: {
      mimetype: ptt ? 'audio/ogg; codecs=opus' : 'audio/mpeg',
      ptt,
      mediaKey: Buffer.from('key'),
      directPath: '/status/audio',
      ...overrides,
    },
  };
}

function statusText(text = 'status words') {
  return { conversation: text };
}

function statusMsg({
  id = 'ST1',
  participant = AUTHOR,
  message = statusImage(),
  messageTimestamp = 1_700_000_000,
} = {}) {
  return {
    key: {
      id,
      remoteJid: STATUS_BROADCAST_JID,
      participant,
      fromMe: false,
    },
    message,
    messageTimestamp,
  };
}

function context(overrides = {}) {
  const replies = [];
  const contents = [];
  const sent = [];
  const ctx = {
    prefix: '!',
    args: ['realm'],
    argsText: 'realm',
    senderJid: OWNER,
    botJid: BOT,
    chatJid: GROUP,
    isGroup: true,
    isOwner: true,
    isSudo: false,
    config: { ownerJid: OWNER, ownerDisplay: 'The Sovereign' },
    groupMeta: { subject: 'Test Domain' },
    quoted: null,
    statusCache: createStatusCache(),
    logger,
    sock: {
      async sendMessage(jid, content) {
        sent.push({ jid, content });
        return { key: { id: `owner-${sent.length}` } };
      },
    },
    reply: async (text) => {
      replies.push({ text });
      return { ok: true };
    },
    replyContent: async (content) => {
      contents.push(content);
      return { key: { id: `chat-${contents.length}` } };
    },
    downloadStatus: async () => IMAGE,
    ...overrides,
  };
  return { ctx, replies, contents, sent };
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

function makeSocket() {
  const sent = [];
  return {
    user: { id: BOT },
    sent,
    ev: { on() {}, off() {}, removeAllListeners() {} },
    async sendMessage(jid, content, options = {}) {
      sent.push({ jid, content, options });
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
  };
}

function makeRegistry(commands) {
  const byName = new Map(commands.map((command) => [command.name, command]));
  return {
    get: (name) => byName.get(name) || null,
    size: byName.size,
    all: () => [...byName.values()],
    categories: () => [],
  };
}

test('echo is registered once under Sovereign without aliases or vv overlap', async () => {
  const loaded = await registry();
  const echo = loaded.get('echo');
  const vv = loaded.get('vv');
  const vv2 = loaded.get('vv2');

  assert.ok(echo);
  assert.equal(echo.category, 'sovereign');
  assert.deepEqual(echo.permissions, ['owner']);
  assert.deepEqual(echo.aliases, []);
  assert.equal(echo.usage, 'echo <soul|realm>');
  assert.notEqual(echo, vv);
  assert.notEqual(echo, vv2);
  assert.equal(loaded.all().filter((command) => command.name === 'echo').length, 1);
});

test('parseEchoMode and status JID helpers stay strict', () => {
  assert.equal(parseEchoMode('soul'), 'soul');
  assert.equal(parseEchoMode('REALM'), 'realm');
  assert.equal(parseEchoMode('vv'), null);
  assert.equal(parseEchoMode(''), null);
  assert.equal(isStatusBroadcastJid(STATUS_BROADCAST_JID), true);
  assert.equal(isStatusBroadcastJid('123@broadcast'), false);
});

test('inspectStatusMessage accepts text, image, video and voice statuses', () => {
  const text = inspectStatusMessage(statusText('hello realm'));
  assert.equal(text.ok, true);
  assert.equal(text.kind, 'text');
  assert.equal(text.text, 'hello realm');

  const extended = inspectStatusMessage({ extendedTextMessage: { text: 'extended' } });
  assert.equal(extended.ok, true);
  assert.equal(extended.kind, 'text');

  const image = inspectStatusMessage(statusImage());
  assert.equal(image.ok, true);
  assert.equal(image.kind, 'image');
  assert.equal(image.caption, 'status still');

  const video = inspectStatusMessage({ ephemeralMessage: { message: statusVideo() } });
  assert.equal(video.ok, true);
  assert.equal(video.kind, 'video');

  const voice = inspectStatusMessage(statusAudio({ ptt: true }));
  assert.equal(voice.ok, true);
  assert.equal(voice.kind, 'voice');
});

test('inspectStatusMessage rejects unsupported or empty status payloads', () => {
  assert.equal(inspectStatusMessage(null).ok, false);
  assert.equal(inspectStatusMessage({ stickerMessage: { mimetype: 'image/webp' } }).ok, false);
  assert.equal(inspectStatusMessage({ conversation: '   ' }).reason, ECHO_UNAVAILABLE);
});

test('status cache is bounded, expires, and does not duplicate ids', () => {
  let now = 1_000;
  const cache = createStatusCache({ maxEntries: 2, ttlMs: 100, now: () => now });

  observeStatusMessage(cache, statusMsg({ id: 'A', message: statusText('a') }));
  observeStatusMessage(cache, statusMsg({ id: 'B', message: statusText('b') }));
  observeStatusMessage(cache, statusMsg({ id: 'A', message: statusText('a-again') }));
  assert.equal(cache.size, 2);
  assert.equal(cache.get('A').inspected.text, 'a-again');
  assert.equal(cache.latest().id, 'A');

  observeStatusMessage(cache, statusMsg({ id: 'C', message: statusText('c') }));
  assert.equal(cache.size, 2);
  assert.equal(cache.get('B'), null);
  assert.ok(cache.get('A'));
  assert.ok(cache.get('C'));

  now = 1_200;
  assert.equal(cache.get('C'), null);
  assert.equal(cache.size, 0);
  assert.equal(cache.maxEntries, 2);
  assert.equal(DEFAULT_STATUS_CACHE_LIMIT, 32);
});

test('resolveRelevantStatus prefers a quoted status, else the latest viewed cache entry', () => {
  const cache = createStatusCache();
  observeStatusMessage(cache, statusMsg({ id: 'OLD', message: statusText('old') }));
  observeStatusMessage(cache, statusMsg({ id: 'NEW', message: statusText('new') }));

  const latest = resolveRelevantStatus({ statusCache: cache, quoted: null });
  assert.equal(latest.id, 'NEW');
  assert.equal(latest.authorJid, AUTHOR);

  const quoted = resolveRelevantStatus({
    statusCache: cache,
    quoted: {
      message: statusImage(),
      participant: AUTHOR,
      stanzaId: 'OLD',
      remoteJid: STATUS_BROADCAST_JID,
    },
  });
  assert.equal(quoted.id, 'OLD');
  assert.equal(quoted.inspected.kind, 'image');

  const fromCacheOnly = resolveRelevantStatus({
    statusCache: cache,
    quoted: {
      message: null,
      stanzaId: 'OLD',
      remoteJid: STATUS_BROADCAST_JID,
      participant: AUTHOR,
    },
  });
  assert.equal(fromCacheOnly.id, 'OLD');
  assert.equal(fromCacheOnly.inspected.text, 'old');
});

test('resolveRelevantStatus rejects non-status quotes and missing content', () => {
  const cache = createStatusCache();
  assert.throws(() => resolveRelevantStatus({ statusCache: cache, quoted: null }), (error) => {
    assert.equal(error instanceof CommandError, true);
    assert.equal(error.message, ECHO_UNAVAILABLE);
    return true;
  });

  assert.throws(
    () =>
      resolveRelevantStatus({
        statusCache: cache,
        quoted: { message: { conversation: 'chat' }, remoteJid: GROUP, stanzaId: 'X' },
      }),
    (error) => {
      assert.equal(error.message, ECHO_NOT_STATUS);
      return true;
    },
  );

  assert.throws(
    () =>
      resolveRelevantStatus({
        statusCache: cache,
        quoted: {
          message: null,
          remoteJid: STATUS_BROADCAST_JID,
          stanzaId: 'MISSING',
          participant: AUTHOR,
        },
      }),
    (error) => {
      assert.equal(error.message, ECHO_UNAVAILABLE);
      return true;
    },
  );
});

test('!echo realm delivers recovered image, video, audio and text to the invoking chat', async () => {
  const loaded = await registry();
  const command = loaded.get('echo');

  const imageCase = context({
    args: ['realm'],
    quoted: {
      message: statusImage(),
      participant: AUTHOR,
      stanzaId: 'ST1',
      remoteJid: STATUS_BROADCAST_JID,
    },
    downloadStatus: async () => IMAGE,
  });
  await command.execute(imageCase.ctx);
  assert.equal(imageCase.contents.length, 1);
  assert.equal(imageCase.contents[0].image, IMAGE);
  assert.equal(imageCase.contents[0].caption, 'status still');
  assert.equal(imageCase.sent.length, 0);
  assert.equal(imageCase.replies.length, 0);

  const videoCase = context({
    args: ['realm'],
    quoted: { message: statusVideo(), remoteJid: STATUS_BROADCAST_JID, stanzaId: 'ST2' },
    downloadStatus: async () => VIDEO,
  });
  await command.execute(videoCase.ctx);
  assert.equal(videoCase.contents[0].video, VIDEO);

  const audioCase = context({
    args: ['realm'],
    quoted: { message: statusAudio({ ptt: true }), remoteJid: STATUS_BROADCAST_JID, stanzaId: 'ST3' },
    downloadStatus: async () => AUDIO,
  });
  await command.execute(audioCase.ctx);
  assert.equal(audioCase.contents[0].audio, AUDIO);
  assert.equal(audioCase.contents[0].ptt, true);

  const textCase = context({
    args: ['realm'],
    quoted: { message: statusText('spoken'), remoteJid: STATUS_BROADCAST_JID, stanzaId: 'ST4' },
  });
  await command.execute(textCase.ctx);
  assert.equal(textCase.contents[0].text, 'spoken');
});

test('!echo soul delivers recovered content only to the owner DM', async () => {
  const loaded = await registry();
  const command = loaded.get('echo');
  const { ctx, replies, contents, sent } = context({
    args: ['soul'],
    argsText: 'soul',
    quoted: {
      message: statusImage(),
      participant: AUTHOR,
      stanzaId: 'ST1',
      remoteJid: STATUS_BROADCAST_JID,
    },
    downloadStatus: async () => IMAGE,
  });

  await command.execute(ctx);

  assert.equal(contents.length, 0);
  assert.equal(replies.length, 0);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].jid, OWNER);
  assert.equal(sent[0].content.image, IMAGE);
  assert.match(sent[0].content.caption, /Viewed status \(image\)/);
  assert.match(sent[0].content.caption, new RegExp(`Author: ${AUTHOR}`));
  assert.match(sent[0].content.caption, /status still/);
});

test('!echo soul never falls back to the invoking chat on owner or delivery failure', async () => {
  const loaded = await registry();
  const command = loaded.get('echo');

  for (const ownerJid of [null, '', 'not-a-jid', GROUP]) {
    const { ctx, replies, contents, sent } = context({
      args: ['soul'],
      config: { ownerJid },
      quoted: { message: statusImage(), remoteJid: STATUS_BROADCAST_JID, stanzaId: 'ST1' },
    });
    await assert.rejects(() => command.execute(ctx), (error) => {
      assert.equal(error instanceof CommandError, true);
      assert.equal(error.message, OWNER_MISSING);
      return true;
    });
    assert.equal(contents.length, 0);
    assert.equal(replies.length, 0);
    assert.equal(sent.length, 0);
  }

  const deliveryFail = context({
    args: ['soul'],
    quoted: { message: statusImage(), remoteJid: STATUS_BROADCAST_JID, stanzaId: 'ST1' },
    sock: {
      async sendMessage() {
        throw new Error('dm closed');
      },
    },
  });
  await assert.rejects(() => command.execute(deliveryFail.ctx), /could not be delivered/);
  assert.equal(deliveryFail.contents.length, 0);
  assert.equal(deliveryFail.replies.length, 0);
});

test('!echo does not claim success when content is missing, expired, or delivery fails', async () => {
  const loaded = await registry();
  const command = loaded.get('echo');

  const usage = context({ args: [], argsText: '' });
  await assert.rejects(() => command.execute(usage.ctx), (error) => {
    assert.equal(error.message, ECHO_USAGE);
    return true;
  });
  assert.equal(usage.contents.length, 0);

  const missing = context({ args: ['realm'], quoted: null, statusCache: createStatusCache() });
  await assert.rejects(() => command.execute(missing.ctx), (error) => {
    assert.equal(error.message, ECHO_UNAVAILABLE);
    return true;
  });
  assert.equal(missing.contents.length, 0);

  const expired = context({
    args: ['realm'],
    quoted: {
      message: null,
      remoteJid: STATUS_BROADCAST_JID,
      stanzaId: 'GONE',
      participant: AUTHOR,
    },
  });
  await assert.rejects(() => command.execute(expired.ctx), (error) => {
    assert.equal(error.message, ECHO_UNAVAILABLE);
    return true;
  });
  assert.equal(expired.contents.length, 0);

  const downloadFail = context({
    args: ['realm'],
    quoted: { message: statusImage(), remoteJid: STATUS_BROADCAST_JID, stanzaId: 'ST1' },
    downloadStatus: async () => {
      throw new Error('expired');
    },
  });
  await assert.rejects(() => command.execute(downloadFail.ctx), /could not be retrieved/);
  assert.equal(downloadFail.contents.length, 0);
  assert.equal(downloadFail.replies.length, 0);

  const emptyBuffer = context({
    args: ['realm'],
    quoted: { message: statusImage(), remoteJid: STATUS_BROADCAST_JID, stanzaId: 'ST1' },
    downloadStatus: async () => Buffer.alloc(0),
  });
  await assert.rejects(() => command.execute(emptyBuffer.ctx), /could not be retrieved/);

  const noKeys = context({
    args: ['realm'],
    quoted: {
      message: { imageMessage: { mimetype: 'image/jpeg', caption: 'ghost' } },
      remoteJid: STATUS_BROADCAST_JID,
      stanzaId: 'ST9',
    },
  });
  delete noKeys.ctx.downloadStatus;
  await assert.rejects(() => command.execute(noKeys.ctx), (error) => {
    assert.equal(error.message, ECHO_MISSING_MEDIA);
    return true;
  });
  assert.equal(noKeys.contents.length, 0);

  const deliveryNull = context({
    args: ['realm'],
    quoted: { message: statusImage(), remoteJid: STATUS_BROADCAST_JID, stanzaId: 'ST1' },
    replyContent: async () => null,
  });
  await assert.rejects(() => command.execute(deliveryNull.ctx), (error) => {
    assert.equal(error.message, DELIVERY_FAILED);
    return true;
  });
  assert.equal(deliveryNull.replies.length, 0);
});

test('recoverViewedStatus and send helpers stay strict', async () => {
  const recovered = await recoverViewedStatus({
    quoted: { message: statusText('kept'), remoteJid: STATUS_BROADCAST_JID, stanzaId: 'T1' },
  });
  assert.equal(recovered.kind, 'text');
  assert.deepEqual(toStatusSendContent(recovered), { text: 'kept' });

  const caption = statusRevealCaption({
    kind: 'image',
    authorJid: AUTHOR,
    id: 'ST1',
    caption: 'status still',
  });
  assert.match(caption, /Viewed status \(image\)/);
  assert.match(caption, /status still/);
});

test('handler observes status@broadcast before ignoring it and never treats it as a command', async (t) => {
  const db = new NexusDatabase(':memory:');
  t.after(() => db.close());
  db.setSetting('access_mode', 'awaken');
  const socket = makeSocket();
  const loaded = await registry();
  const handler = createHandler({
    config: makeConfig(),
    db,
    logger,
    registry: loaded,
    connection: { state: 'open', uptimeMs: 1 },
    services: {},
  });
  t.after(() => handler.shutdown());

  await handler.handleUpsert(socket, {
    type: 'append',
    messages: [statusMsg({ id: 'VIEW1', message: statusText('seen') })],
  });
  assert.equal(handler.statusCache.get('VIEW1').inspected.text, 'seen');
  assert.equal(socket.sent.length, 0);

  await handler.processMessage(socket, statusMsg({ id: 'VIEW2', message: statusImage() }));
  assert.ok(handler.statusCache.get('VIEW2'));
  assert.equal(socket.sent.length, 0);

  await handler.processMessage(socket, {
    key: { id: 'CMD1', remoteJid: GROUP, participant: MEMBER, fromMe: false },
    message: { conversation: '!echo realm' },
  });
  assert.match(socket.sent.at(-1).content.text, /AUTHORITY DENIED/);
});

test('owner can invoke echo realm through the handler using a cached viewed status', async (t) => {
  const db = new NexusDatabase(':memory:');
  t.after(() => db.close());
  const socket = makeSocket();
  const loaded = await registry();
  const handler = createHandler({
    config: makeConfig(),
    db,
    logger,
    registry: loaded,
    connection: { state: 'open', uptimeMs: 1 },
    services: {},
  });
  t.after(() => handler.shutdown());

  await handler.handleUpsert(socket, {
    type: 'notify',
    messages: [statusMsg({ id: 'LIVE1', message: statusText('from the cache') })],
  });

  await handler.processMessage(socket, {
    key: { id: 'OWN1', remoteJid: OWNER, fromMe: false },
    message: { conversation: '!echo realm' },
  });

  const delivered = socket.sent.find((entry) => entry.content?.text === 'from the cache');
  assert.ok(delivered);
  assert.equal(delivered.jid, OWNER);
});

test('vv and vv2 still recover view-once media and do not share echo destinations', async () => {
  const loaded = await registry();
  const vv = loaded.get('vv');
  const vv2 = loaded.get('vv2');
  const quotedViewOnce = {
    viewOnceMessage: {
      message: { imageMessage: { mimetype: 'image/jpeg', caption: 'hidden still' } },
    },
  };

  const chat = context({
    quoted: { message: quotedViewOnce, participant: MEMBER },
    downloadViewOnce: async () => IMAGE,
  });
  chat.ctx.downloadViewOnce = async () => IMAGE;
  await vv.execute(chat.ctx);
  assert.equal(chat.contents[0].image, IMAGE);
  assert.equal(chat.replies[0].text, VV_SUCCESS_MESSAGE);
  assert.equal(chat.sent.length, 0);

  const owner = context({
    quoted: { message: quotedViewOnce, participant: MEMBER },
  });
  owner.ctx.downloadViewOnce = async () => IMAGE;
  await vv2.execute(owner.ctx);
  assert.equal(owner.contents.length, 0);
  assert.equal(owner.sent[0].jid, OWNER);
  assert.match(owner.sent[0].content.caption, /Recovered view-once image/);
});

test('echo does not treat a quoted view-once chat message as a status', async () => {
  const loaded = await registry();
  const command = loaded.get('echo');
  const { ctx, contents, sent, replies } = context({
    args: ['realm'],
    quoted: {
      message: {
        viewOnceMessage: {
          message: { imageMessage: { mimetype: 'image/jpeg', viewOnce: true } },
        },
      },
      remoteJid: GROUP,
      stanzaId: 'VO1',
    },
  });
  await assert.rejects(() => command.execute(ctx), (error) => {
    assert.equal(error.message, ECHO_NOT_STATUS);
    return true;
  });
  assert.equal(contents.length, 0);
  assert.equal(sent.length, 0);
  assert.equal(replies.length, 0);
});

test('quoted context from the handler includes status stanza id and remote jid', async (t) => {
  let captured = null;
  const command = {
    name: 'probe',
    aliases: [],
    description: 'Capture quoted context.',
    category: 'sovereign',
    usage: 'probe',
    permissions: ['owner'],
    cooldownMs: 0,
    async execute(ctx) {
      captured = ctx.quoted;
    },
  };
  const db = new NexusDatabase(':memory:');
  t.after(() => db.close());
  const socket = makeSocket();
  const handler = createHandler({
    config: makeConfig(),
    db,
    logger,
    registry: makeRegistry([command]),
    connection: { state: 'open', uptimeMs: 1 },
    services: {},
  });
  t.after(() => handler.shutdown());

  await handler.processMessage(socket, {
    key: { id: 'Q1', remoteJid: OWNER, fromMe: false },
    message: {
      extendedTextMessage: {
        text: '!probe',
        contextInfo: {
          stanzaId: 'ST9',
          remoteJid: STATUS_BROADCAST_JID,
          participant: AUTHOR,
          quotedMessage: statusText('quoted status'),
        },
      },
    },
  });

  assert.equal(captured.stanzaId, 'ST9');
  assert.equal(captured.remoteJid, STATUS_BROADCAST_JID);
  assert.equal(captured.participant, AUTHOR);
  assert.equal(captured.text, 'quoted status');
  assert.equal(handler.statusCache.size, 0);
});
