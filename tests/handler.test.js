import test from 'node:test';
import assert from 'node:assert/strict';
import { createHandler } from '../handler/handler.js';
import { NexusDatabase } from '../lib/database.js';
import { createLogger } from '../lib/logger.js';

const GROUP = '120363000000000000@g.us';
const MEMBER = '111@s.whatsapp.net';
const ADMIN = '222@s.whatsapp.net';
const SUDO = '333@s.whatsapp.net';
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

function makeSocket(groupMeta = makeGroupMeta(), user = { id: BOT }) {
  const sent = [];
  return {
    user,
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
  const byAlias = new Map();
  for (const command of commands) {
    for (const alias of command.aliases || []) byAlias.set(alias, command);
  }
  return {
    get: (name) => byName.get(name) || byAlias.get(name) || null,
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

function createHarness(t, { commands = [makeCommand()], config = {}, groupMeta, accessMode = 'awaken', user } = {}) {
  const db = new NexusDatabase(':memory:');
  if (accessMode) db.setSetting('access_mode', accessMode);
  const socket = makeSocket(groupMeta, user);
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

test('a timed-out command cannot send a later success after the timeout reply', async (t) => {
  let finish;
  const started = new Promise((resolve) => {
    finish = resolve;
  });
  const command = makeCommand({
    name: 'isis',
    async execute(ctx) {
      finish();
      await new Promise((resolve) => setTimeout(resolve, 40));
      await ctx.replyContent({ image: { url: 'https://cdn.example.test/late.png' }, caption: 'late success' });
      await ctx.reply('late success');
    },
  });
  const { socket, handler } = createHarness(t, {
    commands: [command],
    config: { executionTimeoutMs: 10 },
  });
  const processed = handler.processMessage(socket, makeMessage({ text: '!isis storm' }));
  await started;
  await processed;
  await new Promise((resolve) => setTimeout(resolve, 60));

  assert.equal(socket.sent.length, 1);
  assert.match(socket.sent[0].content.text, /execution limit/);
  assert.equal(socket.sent[0].content.image, undefined);
});

test('a command timeoutMs override is used without changing the default timeout', async (t) => {
  let slowRan = false;
  const slow = makeCommand({
    name: 'isis',
    timeoutMs: 80,
    async execute() {
      await new Promise((resolve) => setTimeout(resolve, 30));
      slowRan = true;
    },
  });
  const { socket, handler } = createHarness(t, {
    commands: [slow],
    config: { executionTimeoutMs: 10 },
  });
  await handler.processMessage(socket, makeMessage({ text: '!isis storm' }));
  assert.equal(slowRan, true);
  assert.equal(socket.sent.length, 0);

  let fastFailed = false;
  const fast = makeCommand({
    async execute() {
      await new Promise((resolve) => setTimeout(resolve, 30));
      fastFailed = true;
    },
  });
  const second = createHarness(t, {
    commands: [fast],
    config: { executionTimeoutMs: 10 },
  });
  await second.handler.processMessage(second.socket, makeMessage({ text: '!echo hello' }));
  assert.equal(fastFailed, false);
  assert.match(second.socket.sent[0].content.text, /execution limit/);
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
  assert.equal(db.countWarnings(GROUP, MEMBER), 0);
  assert.equal(db.runes.getViolationCount(GROUP, MEMBER, 'link'), 1);
  assert.ok(socket.sent.some((entry) => /LINK RUNE/.test(entry.content.text || '')));
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

test('missing access mode defaults to COVENANT and silently ignores ordinary users', async (t) => {
  let executed = 0;
  const command = makeCommand({
    async execute() {
      executed += 1;
    },
  });
  const { db, socket, handler, games } = createHarness(t, { commands: [command], accessMode: null });
  assert.equal(db.getSetting('access_mode'), null);
  db.addOperator(SUDO, OWNER);
  const game = {
    calls: [],
    onText(session, text) {
      this.calls.push(text);
    },
  };
  games.start(MEMBER, { type: 'test', game });

  await handler.processMessage(socket, makeMessage({ id: 'C1', text: '!echo hello' }));
  await handler.processMessage(socket, makeMessage({ id: 'C2', text: '!unknown' }));
  await handler.processMessage(socket, makeMessage({ id: 'C3', text: 'game move' }));
  assert.equal(executed, 0);
  assert.equal(socket.sent.length, 0);
  assert.equal(game.calls.length, 0);
  assert.equal(db.getUser(MEMBER), null);

  await handler.processMessage(socket, makeMessage({ id: 'C4', chat: SUDO, text: '!echo hello' }));
  await handler.processMessage(socket, makeMessage({ id: 'C5', chat: OWNER, text: '!echo hello' }));
  assert.equal(executed, 2);
});

test('VEIL permits only the owner and silently ignores sudo and ordinary users', async (t) => {
  let executed = 0;
  const command = makeCommand({
    async execute() {
      executed += 1;
    },
  });
  const { db, socket, handler, games } = createHarness(t, { commands: [command] });
  db.setSetting('access_mode', 'veil');
  db.addOperator(SUDO, OWNER);
  db.ensureGroup(GROUP, 'Test Domain');
  db.updateGroup(GROUP, { antilink: 1 });
  const game = {
    calls: [],
    onText(session, text, api, input) {
      this.calls.push({ session, text, api, input });
    },
  };
  games.start(MEMBER, { type: 'test', game });

  await handler.processMessage(socket, makeMessage({ id: 'V1', text: '!echo hello' }));
  await handler.processMessage(socket, makeMessage({ id: 'V2', text: '!unknown' }));
  await handler.processMessage(socket, makeMessage({ id: 'V3', chat: SUDO, text: '!echo hello' }));
  await handler.processMessage(
    socket,
    makeMessage({ id: 'V4', chat: GROUP, sender: MEMBER, text: 'https://example.com' }),
  );
  await handler.processMessage(socket, makeMessage({ id: 'V5', text: 'game move' }));

  assert.equal(executed, 0);
  assert.ok(socket.sent.some((entry) => entry.content.delete?.id === 'V4'));
  assert.equal(game.calls.length, 0);
  assert.equal(db.getUser(MEMBER), null);
  assert.equal(db.countWarnings(GROUP, MEMBER), 0);

  await handler.processMessage(
    socket,
    makeMessage({ id: 'V6', chat: OWNER, text: '!echo hello' }),
  );
  assert.equal(executed, 1);
});

test('COVENANT permits the owner and sudo users and silently ignores ordinary users', async (t) => {
  let executed = 0;
  const command = makeCommand({
    async execute() {
      executed += 1;
    },
  });
  const { db, socket, handler, games } = createHarness(t, { commands: [command] });
  db.setSetting('access_mode', 'covenant');
  db.addOperator(SUDO, OWNER);
  db.ensureGroup(GROUP, 'Test Domain');
  db.updateGroup(GROUP, { antilink: 1 });
  const game = {
    calls: [],
    onText(session, text) {
      this.calls.push(text);
    },
  };
  games.start(MEMBER, { type: 'test', game });

  await handler.processMessage(socket, makeMessage({ id: 'W1', text: '!echo hello' }));
  await handler.processMessage(socket, makeMessage({ id: 'W2', text: '!unknown' }));
  await handler.processMessage(socket, makeMessage({ id: 'W3', text: 'game move' }));
  await handler.processMessage(
    socket,
    makeMessage({ id: 'W6', chat: GROUP, sender: MEMBER, text: 'https://example.com' }),
  );
  assert.equal(executed, 0);
  assert.ok(socket.sent.some((entry) => entry.content.delete?.id === 'W6'));
  assert.equal(game.calls.length, 0);
  assert.equal(db.getUser(MEMBER), null);

  await handler.processMessage(socket, makeMessage({ id: 'W4', chat: SUDO, text: '!echo hello' }));
  await handler.processMessage(socket, makeMessage({ id: 'W5', chat: OWNER, text: '!echo hello' }));
  assert.equal(executed, 2);
});

test('AWAKEN permits public access subject to existing command permissions', async (t) => {
  let executed = false;
  const command = makeCommand({
    permissions: ['owner'],
    cooldownMs: 0,
    async execute() {
      executed = true;
    },
  });
  const { db, socket, handler } = createHarness(t, { commands: [command] });
  db.setSetting('access_mode', 'awaken');

  await handler.processMessage(socket, makeMessage({ id: 'P1', text: '!echo hello' }));
  assert.equal(executed, false);
  assert.match(socket.sent[0].content.text, /AUTHORITY DENIED/);

  await handler.processMessage(socket, makeMessage({ id: 'P2', text: '!unknown' }));
  assert.match(socket.sent[1].content.text, /UNKNOWN CURSE/);

  await handler.processMessage(
    socket,
    makeMessage({ id: 'P3', chat: OWNER, text: '!echo hello' }),
  );
  assert.equal(executed, true);
});

test('only the owner can change modes; sudo users cannot', async (t) => {
  let seen = null;
  const command = makeCommand({
    name: 'mode',
    permissions: ['owner'],
    async execute(ctx) {
      seen = ctx.senderJid;
      await ctx.reply(`mode:${ctx.argsText || 'status'}`);
    },
  });
  const { db, socket, handler } = createHarness(t, { commands: [command] });
  db.addOperator(SUDO, OWNER);

  await handler.processMessage(socket, makeMessage({ id: 'M1', chat: SUDO, text: '!mode veil' }));
  assert.equal(seen, null);
  assert.match(socket.sent.at(-1).content.text, /AUTHORITY DENIED/);

  await handler.processMessage(socket, makeMessage({ id: 'M2', chat: OWNER, text: '!mode veil' }));
  assert.equal(seen, OWNER);
  assert.match(socket.sent.at(-1).content.text, /mode:veil/);
});

test('restricted modes do not block group participant lifecycle events', async (t) => {
  const { db, socket, handler } = createHarness(t);
  db.setSetting('access_mode', 'veil');
  db.ensureGroup(GROUP, 'Test Domain');
  db.updateGroup(GROUP, { welcome_enabled: 1 });
  await handler.handleParticipants(socket, { id: GROUP, participants: [MEMBER], action: 'add' });
  assert.equal(socket.sent.length, 1);
  assert.match(socket.sent[0].content.text, /@111 entered Test Domain\./);
});

test('non-owners cannot bind, unbind or list sudo users', async (t) => {
  const bound = [];
  const bind = makeCommand({
    name: 'bind',
    aliases: ['sudo', 'edictor', 'operators'],
    permissions: ['owner'],
    async execute(ctx) {
      bound.push(ctx.commandName);
      await ctx.reply(`bind:${ctx.argsText}`);
    },
  });
  const unbind = makeCommand({
    name: 'unbind',
    permissions: ['owner'],
    async execute(ctx) {
      bound.push('unbind');
      await ctx.reply(`unbind:${ctx.argsText}`);
    },
  });
  const { db, socket, handler } = createHarness(t, { commands: [bind, unbind] });
  db.addOperator(SUDO, OWNER);

  await handler.processMessage(socket, makeMessage({ id: 'B1', chat: SUDO, text: '!bind list' }));
  await handler.processMessage(socket, makeMessage({ id: 'B2', chat: MEMBER, text: '!unbind @333' }));
  await handler.processMessage(socket, makeMessage({ id: 'B3', chat: SUDO, text: '!sudo add @111' }));
  assert.equal(bound.length, 0);
  assert.equal(socket.sent.length, 3);
  assert.ok(socket.sent.every((entry) => /AUTHORITY DENIED/.test(entry.content.text)));

  await handler.processMessage(socket, makeMessage({ id: 'B4', chat: OWNER, text: '!bind list' }));
  assert.deepEqual(bound, ['bind']);
});

test('linked-owner phone commands pass fromMe while bot outbound 3EB0 ids stay ignored', async (t) => {
  let executed = 0;
  const command = makeCommand({
    async execute() {
      executed += 1;
    },
  });
  const { socket, handler } = createHarness(t, {
    commands: [command],
    config: { ownerJid: BOT },
    user: { id: `${BOT.split('@')[0]}:12@s.whatsapp.net`, lid: '111111111111111@lid' },
    accessMode: 'covenant',
  });

  await handler.processMessage(
    socket,
    makeMessage({ id: '3EB0DEADBEEFCAFE01', chat: MEMBER, fromMe: true, text: '!echo hello' }),
  );
  assert.equal(executed, 0);
  assert.equal(socket.sent.length, 0);

  await handler.processMessage(
    socket,
    makeMessage({ id: 'PHONEOWNER1', chat: MEMBER, fromMe: true, text: '!echo hello' }),
  );
  assert.equal(executed, 1);
});

test('fromMe commands from a non-owner bot session remain ignored', async (t) => {
  let executed = 0;
  const command = makeCommand({
    async execute() {
      executed += 1;
    },
  });
  const { socket, handler } = createHarness(t, { commands: [command], accessMode: 'covenant' });

  await handler.processMessage(
    socket,
    makeMessage({ id: 'PHONESTRANGER1', chat: MEMBER, fromMe: true, text: '!echo hello' }),
  );
  assert.equal(executed, 0);
  assert.equal(socket.sent.length, 0);
});

test('linked owner can run owner-only commands in a group via fromMe', async (t) => {
  let seen = null;
  const command = makeCommand({
    name: 'mode',
    permissions: ['owner'],
    async execute(ctx) {
      seen = ctx.senderJid;
      await ctx.reply(`mode:${ctx.argsText || 'status'}`);
    },
  });
  const { socket, handler } = createHarness(t, {
    commands: [command],
    config: { ownerJid: BOT },
    user: { id: BOT },
    accessMode: 'covenant',
  });

  await handler.processMessage(
    socket,
    makeMessage({
      id: 'PHONEOWNER2',
      chat: GROUP,
      sender: BOT,
      fromMe: true,
      text: '!mode veil',
    }),
  );
  assert.equal(seen, BOT);
  assert.match(socket.sent.at(-1).content.text, /mode:veil/);
});