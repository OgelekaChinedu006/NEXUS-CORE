import test from 'node:test';
import assert from 'node:assert/strict';
import { createHandler } from '../handler/handler.js';
import { NexusDatabase } from '../lib/database.js';
import { createLogger } from '../lib/logger.js';

const GROUP = '120363000000000000@g.us';
const MEMBER = '111@s.whatsapp.net';
const ADMIN = '222@s.whatsapp.net';
const BOT = '999@s.whatsapp.net';
const OWNER = 'owner@s.whatsapp.net';
const logger = createLogger({ level: 'silent' });

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

function makeGroupMeta(botAdmin = false) {
  return {
    subject: 'Test Domain',
    desc: 'Obey.',
    size: 3,
    owner: ADMIN,
    participants: [
      { id: MEMBER },
      { id: ADMIN, admin: 'superadmin' },
      { id: BOT, admin: botAdmin ? 'admin' : undefined },
    ],
  };
}

function makeSocket(groupMeta = makeGroupMeta()) {
  const sent = [];
  return {
    user: { id: BOT },
    sent,
    ev: {
      on() {},
      off() {},
      removeAllListeners() {},
    },
    async sendMessage(jid, content, options = {}) {
      sent.push({ jid, content, options });
      return { key: { id: `sent-${sent.length}` } };
    },
    async groupMetadata() {
      return groupMeta;
    },
    async groupParticipantsUpdate() {
      return [];
    },
  };
}

function makeCommand(overrides = {}) {
  return {
    name: 'echo',
    aliases: [],
    description: 'Echo a message.',
    category: 'general',
    usage: 'echo <text>',
    permissions: ['public'],
    cooldownMs: 0,
    async execute(ctx) {
      await ctx.reply(`echo:${ctx.argsText}`);
    },
    ...overrides,
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

function makeMessage({
  id = 'MSG1',
  chat = MEMBER,
  sender = undefined,
  text = '!echo hello',
  fromMe = false,
} = {}) {
  return {
    key: {
      id,
      remoteJid: chat,
      fromMe,
      ...(sender ? { participant: sender } : {}),
    },
    message: { conversation: text },
  };
}

function createHarness(t, { commands = [makeCommand()], config = {}, groupMeta } = {}) {
  const db = new NexusDatabase(':memory:');
  const socket = makeSocket(groupMeta);
  const connection = { state: 'open', uptimeMs: 1000 };
  const handler = createHandler({
    config: makeConfig(config),
    db,
    logger,
    registry: makeRegistry(commands),
    connection,
    services: {},
  });
  handler.attach(socket);
  t.after(() => {
    handler.shutdown();
    db.close();
  });
  return { db, socket, handler, games: handler.games };
}

test('bot messages, status broadcasts and newsletters are ignored', async (t) => {
  const { socket, handler } = createHarness(t);
  await handler.processMessage(socket, makeMessage({ fromMe: true }));
  await handler.processMessage(socket, makeMessage({ chat: 'status@broadcast', id: 'S1' }));
  await handler.processMessage(socket, makeMessage({ chat: '123@broadcast', id: 'S2' }));
  await handler.processMessage(socket, makeMessage({ chat: '123@newsletter', id: 'S3' }));
  assert.equal(socket.sent.length, 0);
});

test('messages from the bot itself are ignored after claiming deduplication', async (t) => {
  const { socket, handler } = createHarness(t);
  await handler.processMessage(
    socket,
    makeMessage({ chat: GROUP, sender: BOT, text: '!echo hello' }),
  );
  assert.equal(socket.sent.length, 0);
});

test('duplicate message IDs and duplicate unknown-command notices are throttled', async (t) => {
  const { socket, handler } = createHarness(t);
  const message = makeMessage({ id: 'DUP1', text: '!unknown' });
  await handler.processMessage(socket, message);
  await handler.processMessage(socket, message);
  assert.equal(socket.sent.length, 1);
  assert.match(socket.sent[0].content.text, /UNKNOWN CURSE/);

  await handler.processMessage(socket, makeMessage({ id: 'DUP2', text: '!unknown' }));
  assert.equal(socket.sent.length, 1);
});

test('commands receive parsed arguments and a complete context', async (t) => {
  let captured = null;
  const command = makeCommand({
    async execute(ctx) {
      captured = ctx;
      await ctx.reply(`echo:${ctx.args.join('|')}`);
    },
  });
  const { socket, handler } = createHarness(t, { commands: [command] });
  await handler.processMessage(
    socket,
    makeMessage({ chat: GROUP, sender: MEMBER, text: '!echo one two' }),
  );
  assert.equal(captured.chatJid, GROUP);
  assert.equal(captured.senderJid, MEMBER);
  assert.equal(captured.isGroup, true);
  assert.equal(captured.isAdmin, false);
  assert.deepEqual(captured.args, ['one', 'two']);
  assert.equal(captured.argsText, 'one two');
  assert.match(socket.sent[0].content.text, /echo:one\|two/);
});

test('permission failures are reported before command execution', async (t) => {
  let executed = false;
  const command = makeCommand({
    permissions: ['owner'],
    async execute() {
      executed = true;
    },
  });
  const { socket, handler } = createHarness(t, { commands: [command] });
  await handler.processMessage(
    socket,
    makeMessage({ chat: GROUP, sender: MEMBER, text: '!echo hello' }),
  );
  assert.equal(executed, false);
  assert.match(socket.sent[0].content.text, /AUTHORITY DENIED/);
  assert.match(socket.sent[0].content.text, /Sovereign owner/);
});

test('botAdmin commands fail when the bot is not an admin', async (t) => {
  let executed = false;
  const command = makeCommand({
    permissions: ['admin', 'botAdmin'],
    async execute() {
      executed = true;
    },
  });
  const { socket, handler } = createHarness(t, {
    commands: [command],
    groupMeta: makeGroupMeta(false),
  });
  await handler.processMessage(
    socket,
    makeMessage({ chat: GROUP, sender: ADMIN, text: '!echo hello' }),
  );
  assert.equal(executed, false);
  assert.match(socket.sent[0].content.text, /bot must be a group admin/i);
});

test('command failures are contained and reported without crashing', async (t) => {
  const command = makeCommand({
    async execute() {
      throw new Error('internal failure');
    },
  });
  const { socket, handler } = createHarness(t, { commands: [command] });
  await handler.processMessage(socket, makeMessage({ text: '!echo hello' }));
  assert.equal(socket.sent.length, 1);
  assert.match(socket.sent[0].content.text, /CURSE REJECTED/);
  assert.doesNotMatch(socket.sent[0].content.text, /internal failure/);
});

test('execution timeout prevents a stalled command from hanging the handler', async (t) => {
  const command = makeCommand({
    async execute() {
      await new Promise((resolve) => setTimeout(resolve, 50));
    },
  });
  const { socket, handler } = createHarness(t, {
    commands: [command],
    config: { executionTimeoutMs: 10 },
  });
  await handler.processMessage(socket, makeMessage({ text: '!echo hello' }));
  assert.match(socket.sent[0].content.text, /execution limit/);
});

test('anti-link deletes the offending message and records a warning', async (t) => {
  const { db, socket, handler } = createHarness(t);
  db.ensureGroup(GROUP, 'Test Domain');
  db.updateGroup(GROUP, { antilink: 1, max_warnings: 3 });
  await handler.processMessage(
    socket,
    makeMessage({
      id: 'LINK1',
      chat: GROUP,
      sender: MEMBER,
      text: 'join https://example.com',
    }),
  );
  assert.equal(socket.sent[0].content.delete?.id, 'LINK1');
  assert.equal(db.countWarnings(GROUP, MEMBER), 1);
  assert.ok(socket.sent.some((entry) => /JUDGMENT/.test(entry.content.text || '')));
});

test('admins and allies bypass group security filters', async (t) => {
  const { db, socket, handler } = createHarness(t);
  db.ensureGroup(GROUP, 'Test Domain');
  db.updateGroup(GROUP, { antilink: 1 });
  db.addAlly(GROUP, MEMBER, ADMIN);
  await handler.processMessage(
    socket,
    makeMessage({ id: 'LINK2', chat: GROUP, sender: MEMBER, text: 'https://example.com' }),
  );
  assert.equal(socket.sent.length, 0);
  assert.equal(db.countWarnings(GROUP, MEMBER), 0);
});

test('absence mode silences non-owners and leaves owner commands intact', async (t) => {
  const { db, socket, handler } = createHarness(t);
  db.setSetting('absence_enabled', '1');
  db.setSetting('absence_message', 'The King is absent.');

  await handler.processMessage(socket, makeMessage({ id: 'A1', text: '!echo hello' }));
  assert.match(socket.sent.at(-1).content.text, /ABSENCE/);
  assert.match(socket.sent.at(-1).content.text, /The King is absent\./);

  await handler.processMessage(
    socket,
    makeMessage({ id: 'A2', chat: OWNER, sender: undefined, text: '!echo hello' }),
  );
  assert.match(socket.sent.at(-1).content.text, /echo:hello/);
});

test('per-user rate limits stop excess commands', async (t) => {
  const { socket, handler } = createHarness(t, {
    config: { rateLimit: { windowMs: 10000, maxCommands: 2, noticeCooldownMs: 1000 } },
  });
  await handler.processMessage(socket, makeMessage({ id: 'R1', text: '!echo one' }));
  await handler.processMessage(socket, makeMessage({ id: 'R2', text: '!echo two' }));
  await handler.processMessage(socket, makeMessage({ id: 'R3', text: '!echo three' }));
  assert.equal(socket.sent.length, 3);
  assert.match(socket.sent[2].content.text, /THROTTLED/);
});

test('participant removals reach the game manager before goodbye notices', async (t) => {
  const { socket, handler, games } = createHarness(t);
  const departures = [];
  const game = {
    onText() {},
    async onPlayerLeave(session, playerJid, api, input) {
      departures.push({ session, playerJid, input });
      api.end();
      await api.send({ text: 'player left' });
    },
  };
  const session = games.start(GROUP, { type: 'tictactoe', game, starterJid: MEMBER });

  await handler.handleParticipants(socket, {
    id: GROUP,
    participants: [MEMBER],
    action: 'remove',
  });

  assert.equal(departures.length, 1);
  assert.equal(departures[0].session.id, session.id);
  assert.equal(departures[0].playerJid, MEMBER);
  assert.ok(departures[0].input.groupMeta);
  assert.equal(departures[0].input.socket, socket);
  assert.equal(games.hasSession(GROUP), false);
  assert.equal(socket.sent.length, 1);
  assert.equal(socket.sent[0].content.text, 'player left');
});

test('welcome and goodbye use real participant events and WhatsApp mentions', async (t) => {
  const { db, socket, handler } = createHarness(t);
  db.ensureGroup(GROUP, 'Test Domain');
  db.updateGroup(GROUP, { welcome_enabled: 1, goodbye_enabled: 1 });

  await handler.handleParticipants(socket, { id: GROUP, participants: [MEMBER], action: 'add' });
  assert.equal(socket.sent.length, 1);
  assert.match(socket.sent[0].content.text, /@111 entered Test Domain\./);
  assert.deepEqual(socket.sent[0].content.mentions, [MEMBER]);

  await handler.handleParticipants(socket, { id: GROUP, participants: [MEMBER], action: 'remove' });
  assert.equal(socket.sent.length, 2);
  assert.match(socket.sent[1].content.text, /@111 left Test Domain\./);
  assert.deepEqual(socket.sent[1].content.mentions, [MEMBER]);
});