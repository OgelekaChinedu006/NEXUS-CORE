import test from 'node:test';
import assert from 'node:assert/strict';
import { createHandler } from '../handler/handler.js';
import { NexusDatabase } from '../lib/database.js';
import { createLogger } from '../lib/logger.js';
import { CommandError } from '../lib/helpers.js';
import { createGameManager, GameManager } from '../lib/games/manager.js';
import endgame from '../commands/fun/endgame.js';

const GROUP = '120363000000000000@g.us';
const MEMBER = '111@s.whatsapp.net';
const ADMIN = '222@s.whatsapp.net';
const BOT = '999@s.whatsapp.net';
const OWNER = 'owner@s.whatsapp.net';
const silent = createLogger({ level: 'silent' });

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

function makeGroupMeta() {
  return {
    subject: 'Test Domain',
    desc: 'Obey.',
    size: 3,
    owner: ADMIN,
    participants: [{ id: MEMBER }, { id: ADMIN, admin: 'superadmin' }, { id: BOT }],
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
      return makeGroupMeta();
    },
    async groupParticipantsUpdate() {
      return [];
    },
  };
}

function makeEchoCommand() {
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

function makeMessage({ id, chat = MEMBER, sender = undefined, text = 'hello', fromMe = false }) {
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

function makeGame({ reply = null, throws = null } = {}) {
  const calls = [];
  return {
    calls,
    async onText(session, input, api) {
      calls.push({ session, input });
      if (throws === 'sync') throw new Error('game boom');
      if (throws === 'async') await Promise.reject(new Error('game async boom'));
      if (reply) await api.send(reply);
    },
  };
}

function createHarness(t, { games, logger = silent } = {}) {
  const db = new NexusDatabase(':memory:');
  db.setSetting('access_mode', 'awaken');
  const socket = makeSocket();
  const handler = createHandler({
    config: makeConfig(),
    db,
    logger,
    registry: makeRegistry([makeEchoCommand()]),
    connection: { state: 'open', uptimeMs: 1000 },
    services: {},
    games,
  });
  handler.attach(socket);
  t.after(() => {
    handler.shutdown();
    db.close();
  });
  return { db, socket, handler, games: handler.games };
}

// ── manager (unit) ──────────────────────────────────────────────────────────

test('handleText is a no-op when the chat has no session', async () => {
  const games = createGameManager();
  assert.equal(await games.handleText({ chatJid: GROUP, text: 'hi' }), false);
  assert.equal(await games.handleText(undefined), false);
  assert.equal(games.hasSession(GROUP), false);
  assert.equal(games.get(GROUP), null);
  assert.equal(games.end(GROUP), null);
});

test('start creates a session with an id, and a second start in the same chat is rejected', () => {
  const games = createGameManager();
  const first = games.start(GROUP, { type: 'guess', game: makeGame(), starterJid: `${MEMBER}` });
  assert.equal(typeof first.id, 'string');
  assert.ok(first.id.length > 0);
  assert.equal(first.type, 'guess');
  assert.equal(first.starterJid, MEMBER);
  assert.equal(games.hasSession(GROUP), true);
  assert.equal(games.get(GROUP), first);

  assert.throws(
    () => games.start(GROUP, { type: 'rps', game: makeGame() }),
    (error) => error instanceof CommandError && /guess/.test(error.message),
  );
  assert.equal(games.get(GROUP), first);

  // Other chats are independent, and an ended chat can start again.
  games.start(MEMBER, { type: 'rps', game: makeGame() });
  assert.equal(games.end(GROUP), first);
  assert.equal(games.hasSession(GROUP), false);
  const second = games.start(GROUP, { type: 'rps', game: makeGame() });
  assert.notEqual(second.id, first.id);
});

test('start validates its inputs', () => {
  const games = new GameManager();
  assert.throws(() => games.start('', { game: makeGame() }), TypeError);
  assert.throws(() => games.start(GROUP, { game: {} }), TypeError);
  assert.throws(() => games.start(GROUP, {}), TypeError);
});

test('thrown and rejected game errors are isolated and logged', async () => {
  const errors = [];
  const games = createGameManager({ logger: { error: (m) => errors.push(m), warn() {} } });

  games.start(GROUP, { type: 'sync', game: makeGame({ throws: 'sync' }) });
  assert.equal(await games.handleText({ chatJid: GROUP, text: 'x' }), true);
  assert.equal(games.hasSession(GROUP), true);
  assert.match(errors[0], /game boom/);

  games.end(GROUP);
  games.start(GROUP, { type: 'async', game: makeGame({ throws: 'async' }) });
  assert.equal(await games.handleText({ chatJid: GROUP, text: 'x' }), true);
  assert.match(errors[1], /game async boom/);
});

test('api.send never throws: no socket, a throwing socket, and a missing logger are all safe', async () => {
  // No socket anywhere.
  const none = createGameManager({ getSocket: () => null });
  const bare = none.start(GROUP, { type: 't', game: makeGame() });
  assert.equal(await bare.api.send('hello'), null);

  // getSocket itself throwing is treated as "no socket".
  const throwing = createGameManager({
    getSocket: () => {
      throw new Error('socket lookup failed');
    },
  });
  const s2 = throwing.start(GROUP, { type: 't', game: makeGame() });
  assert.equal(await s2.api.send('hello'), null);

  // A socket whose sendMessage rejects returns null.
  const broken = {
    async sendMessage() {
      throw new Error('send failed');
    },
  };
  const games = createGameManager({ getSocket: () => broken });
  const s3 = games.start(GROUP, { type: 't', game: makeGame() });
  assert.equal(await s3.api.send({ text: 'hello' }), null);

  // Invalid content is ignored.
  assert.equal(await s3.api.send(null), null);
});

test('api.send prefers the live socket and falls back to the socket recorded at start', async () => {
  const recorded = makeSocket();
  const live = makeSocket();
  let current = live;
  const games = createGameManager({ getSocket: () => current });
  const session = games.start(GROUP, { type: 't', game: makeGame(), socket: recorded });

  await session.api.send('one');
  assert.equal(live.sent.length, 1);
  assert.equal(recorded.sent.length, 0);
  assert.deepEqual(live.sent[0].content, { text: 'one' });
  assert.equal(live.sent[0].jid, GROUP);

  current = null;
  await session.api.send({ text: 'two', mentions: [MEMBER] }, { quoted: { key: { id: 'q' } } });
  assert.equal(recorded.sent.length, 1);
  assert.deepEqual(recorded.sent[0].content, { text: 'two', mentions: [MEMBER] });
  assert.deepEqual(recorded.sent[0].options, { quoted: { key: { id: 'q' } } });
});

test('api.end ends only its own session', () => {
  const games = createGameManager();
  const first = games.start(GROUP, { type: 't', game: makeGame() });
  assert.equal(first.api.end(), true);
  assert.equal(games.hasSession(GROUP), false);

  const second = games.start(GROUP, { type: 't', game: makeGame() });
  assert.equal(first.api.end(), false);
  assert.equal(games.get(GROUP), second);
});

// ── timers ──────────────────────────────────────────────────────────────────

test('session timers fire while current, and can be cleared or replaced', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const games = createGameManager();
  const session = games.start(GROUP, { type: 't', game: makeGame() });
  const fired = [];

  assert.equal(session.setTimer('turn', 1000, (s, api) => fired.push(['turn', s.id === session.id, typeof api.send])), true);
  session.setTimer('cleared', 500, () => fired.push('cleared'));
  session.clearTimer('cleared');
  session.setTimer('replaced', 500, () => fired.push('old'));
  session.setTimer('replaced', 800, () => fired.push('new'));

  t.mock.timers.tick(500);
  assert.deepEqual(fired, []);
  t.mock.timers.tick(300);
  assert.deepEqual(fired, ['new']);
  t.mock.timers.tick(200);
  assert.deepEqual(fired, ['new', ['turn', true, 'function']]);
  assert.equal(session.timers.size, 0);
});

test('ending a session clears its timers, and a new session in the chat is unaffected', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const games = createGameManager();
  const fired = [];

  const first = games.start(GROUP, { type: 't', game: makeGame() });
  first.setTimer('x', 1000, () => fired.push('first'));
  games.end(GROUP);
  assert.equal(first.setTimer('late', 1000, () => fired.push('late')), false);

  const second = games.start(GROUP, { type: 't', game: makeGame() });
  second.setTimer('y', 1000, () => fired.push('second'));
  t.mock.timers.tick(1000);
  assert.deepEqual(fired, ['second']);
});

test('a timer whose session is no longer the chat session does not run (stale id guard)', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const games = createGameManager();
  const fired = [];

  const first = games.start(GROUP, { type: 't', game: makeGame() });
  first.setTimer('x', 1000, () => fired.push('stale'));
  // Replace the chat's session without going through end(), so the old timer survives.
  games.sessions.delete(GROUP);
  const second = games.start(GROUP, { type: 't', game: makeGame() });
  second.setTimer('y', 1000, () => fired.push('current'));

  t.mock.timers.tick(1000);
  assert.deepEqual(fired, ['current']);
});

test('shutdown clears every timer and every session', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const games = createGameManager();
  const fired = [];
  const a = games.start(GROUP, { type: 't', game: makeGame() });
  const b = games.start(MEMBER, { type: 't', game: makeGame() });
  a.setTimer('x', 1000, () => fired.push('a'));
  b.setTimer('x', 1000, () => fired.push('b'));

  games.shutdown();
  t.mock.timers.tick(5000);
  assert.deepEqual(fired, []);
  assert.equal(games.hasSession(GROUP), false);
  assert.equal(games.hasSession(MEMBER), false);
});

test('errors thrown by timer callbacks are isolated and logged', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const errors = [];
  const games = createGameManager({ logger: { error: (m) => errors.push(m), warn() {} } });
  const session = games.start(GROUP, { type: 't', game: makeGame() });
  session.setTimer('boom', 100, () => {
    throw new Error('timer boom');
  });
  assert.doesNotThrow(() => t.mock.timers.tick(100));
  assert.match(errors[0], /timer boom/);
});

// ── handler integration ─────────────────────────────────────────────────────

test('plain text without a session is ignored by the handler', async (t) => {
  const { socket, handler } = createHarness(t);
  await handler.processMessage(socket, makeMessage({ id: 'N1', text: 'hello' }));
  await handler.processMessage(socket, makeMessage({ id: 'N2', chat: GROUP, sender: MEMBER, text: 'hello' }));
  assert.equal(socket.sent.length, 0);
});

test('plain text is routed to the chat session, in a DM and in a group', async (t) => {
  const { socket, handler, games } = createHarness(t);
  const dmGame = makeGame({ reply: 'pong' });
  const dm = games.start(MEMBER, { type: 'test', game: dmGame, starterJid: MEMBER });

  await handler.processMessage(socket, makeMessage({ id: 'G1', text: 'hello' }));
  assert.equal(dmGame.calls.length, 1);
  assert.equal(dmGame.calls[0].session.id, dm.id);
  assert.equal(dmGame.calls[0].input.text, 'hello');
  assert.equal(dmGame.calls[0].input.senderJid, MEMBER);
  assert.equal(dmGame.calls[0].input.chatJid, MEMBER);
  assert.equal(dmGame.calls[0].input.isGroup, false);
  assert.equal(socket.sent.length, 1);
  assert.equal(socket.sent[0].jid, MEMBER);
  assert.equal(socket.sent[0].content.text, 'pong');

  const groupGame = makeGame();
  games.start(GROUP, { type: 'test', game: groupGame, starterJid: MEMBER });
  await handler.processMessage(socket, makeMessage({ id: 'G2', chat: GROUP, sender: MEMBER, text: '7' }));
  assert.equal(groupGame.calls.length, 1);
  assert.equal(groupGame.calls[0].input.text, '7');
  assert.equal(groupGame.calls[0].input.isGroup, true);
  assert.equal(groupGame.calls[0].input.senderJid, MEMBER);
  assert.ok(groupGame.calls[0].input.groupMeta);
});

test('messages sent by the bot account are never routed', async (t) => {
  const { socket, handler, games } = createHarness(t);
  const game = makeGame();
  games.start(MEMBER, { type: 'test', game });
  await handler.processMessage(socket, makeMessage({ id: 'F1', fromMe: true, text: 'hello' }));
  assert.equal(game.calls.length, 0);
});

test('globally banned senders are not routed', async (t) => {
  const { db, socket, handler, games } = createHarness(t);
  const game = makeGame();
  games.start(MEMBER, { type: 'test', game });
  db.banGlobal(MEMBER, 'test ban', ADMIN);
  await handler.processMessage(socket, makeMessage({ id: 'B1', text: 'hello' }));
  assert.equal(game.calls.length, 0);
});

test('group-banned senders are not routed', async (t) => {
  const { db, socket, handler, games } = createHarness(t);
  const game = makeGame();
  games.start(GROUP, { type: 'test', game });
  db.ensureGroup(GROUP, 'Test Domain');
  db.banFromGroup(GROUP, MEMBER, 'test ban', ADMIN);
  await handler.processMessage(socket, makeMessage({ id: 'B2', chat: GROUP, sender: MEMBER, text: 'hello' }));
  assert.equal(game.calls.length, 0);
});

test('sealed groups route only admins, owner and sudo', async (t) => {
  const { db, socket, handler, games } = createHarness(t);
  const game = makeGame();
  games.start(GROUP, { type: 'test', game });
  db.ensureGroup(GROUP, 'Test Domain');
  db.updateGroup(GROUP, { sealed: 1 });
  assert.ok(db.getGroup(GROUP).sealed, 'precondition: the group must be sealed');

  await handler.processMessage(socket, makeMessage({ id: 'SE1', chat: GROUP, sender: MEMBER, text: 'hello' }));
  assert.equal(game.calls.length, 0);

  await handler.processMessage(socket, makeMessage({ id: 'SE2', chat: GROUP, sender: ADMIN, text: 'hello' }));
  assert.equal(game.calls.length, 1);
  assert.equal(game.calls[0].input.senderJid, ADMIN);
});

test('absence mode routes only the owner and sudo operators', async (t) => {
  const { db, socket, handler, games } = createHarness(t);
  const memberGame = makeGame();
  const ownerGame = makeGame();
  games.start(MEMBER, { type: 'test', game: memberGame });
  games.start(OWNER, { type: 'test', game: ownerGame });
  db.setSetting('absence_enabled', '1');

  await handler.processMessage(socket, makeMessage({ id: 'AB1', text: 'hello' }));
  assert.equal(memberGame.calls.length, 0);
  assert.equal(socket.sent.length, 0);

  await handler.processMessage(socket, makeMessage({ id: 'AB2', chat: OWNER, text: 'hello' }));
  assert.equal(ownerGame.calls.length, 1);
});

test('antispam-filtered messages are not routed', async (t) => {
  const { db, socket, handler, games } = createHarness(t);
  const game = makeGame();
  games.start(GROUP, { type: 'test', game });
  db.ensureGroup(GROUP, 'Test Domain');
  db.updateGroup(GROUP, { antispam: 1, max_warnings: 3 });
  assert.ok(db.getGroup(GROUP).antispam, 'precondition: antispam must be enabled');

  for (let index = 1; index <= 7; index += 1) {
    await handler.processMessage(
      socket,
      makeMessage({ id: `SP${index}`, chat: GROUP, sender: MEMBER, text: String(index) }),
    );
  }
  // spamThreshold is 7: the first six messages pass, the seventh is filtered.
  assert.equal(game.calls.length, 6);
  assert.deepEqual(game.calls.map((call) => call.input.text), ['1', '2', '3', '4', '5', '6']);
});

test('anti-link-filtered messages are not routed', async (t) => {
  const { db, socket, handler, games } = createHarness(t);
  const game = makeGame();
  games.start(GROUP, { type: 'test', game });
  db.ensureGroup(GROUP, 'Test Domain');
  db.updateGroup(GROUP, { antilink: 1, max_warnings: 3 });
  await handler.processMessage(
    socket,
    makeMessage({ id: 'AL1', chat: GROUP, sender: MEMBER, text: 'https://example.com' }),
  );
  assert.equal(game.calls.length, 0);
});

test('prefixed messages go through the command flow and are not routed', async (t) => {
  const { socket, handler, games } = createHarness(t);
  const game = makeGame();
  games.start(MEMBER, { type: 'test', game });
  await handler.processMessage(socket, makeMessage({ id: 'P1', text: '!echo hi' }));
  assert.equal(game.calls.length, 0);
  assert.match(socket.sent.at(-1).content.text, /echo:hi/);
});

test('a stale socket is replaced by attach before the game replies', async (t) => {
  const { socket: first, handler, games } = createHarness(t);
  games.start(MEMBER, { type: 'test', game: makeGame({ reply: 'via-current' }) });

  const second = makeSocket();
  handler.attach(second);
  await handler.processMessage(second, makeMessage({ id: 'ST1', text: 'go' }));

  assert.equal(first.sent.length, 0);
  assert.equal(second.sent.length, 1);
  assert.equal(second.sent[0].content.text, 'via-current');
});

test('with no live socket, the handler still does not throw and the recorded socket is used', async (t) => {
  const { socket, handler, games } = createHarness(t);
  const session = games.start(MEMBER, { type: 'test', game: makeGame() });
  handler.detach();
  assert.equal(handler.socket, null);
  await assert.doesNotReject(() => session.api.send('late'));
  assert.equal(socket.sent.at(-1).content.text, 'late');
});

test('errors thrown by a routed game never escape the handler', async (t) => {
  const { socket, handler, games } = createHarness(t);
  games.start(MEMBER, { type: 'test', game: makeGame({ throws: 'sync' }) });
  await assert.doesNotReject(() => handler.processMessage(socket, makeMessage({ id: 'E1', text: 'hello' })));
  assert.equal(socket.sent.length, 0);
});

test('an injected games manager is used, shut down with the handler, and routing errors are logged', async (t) => {
  const errors = [];
  let shutdowns = 0;
  const stub = {
    hasSession: () => true,
    async handleText() {
      throw new Error('route boom');
    },
    shutdown() {
      shutdowns += 1;
    },
  };
  const { socket, handler } = createHarness(t, {
    games: stub,
    logger: { error: (m) => errors.push(m), warn() {}, info() {}, debug() {} },
  });
  assert.equal(handler.games, stub);

  await assert.doesNotReject(() => handler.processMessage(socket, makeMessage({ id: 'R1', text: 'hello' })));
  assert.match(errors.join('\n'), /route boom/);

  handler.shutdown();
  assert.equal(shutdowns, 1);
});

test('handler shutdown clears running game timers', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { handler, games } = createHarness(t);
  const fired = [];
  const session = games.start(MEMBER, { type: 'test', game: makeGame() });
  session.setTimer('x', 1000, () => fired.push('x'));
  handler.shutdown();
  t.mock.timers.tick(2000);
  assert.deepEqual(fired, []);
  assert.equal(games.hasSession(MEMBER), false);
});

// ── endgame command ─────────────────────────────────────────────────────────

function makeCtx(games, overrides = {}) {
  const replies = [];
  return {
    replies,
    ctx: {
      games,
      chatJid: GROUP,
      isGroup: true,
      senderJid: MEMBER,
      isOwner: false,
      isSudo: false,
      isAdmin: false,
      groupMeta: makeGroupMeta(),
      reply: async (text) => {
        replies.push(text);
      },
      ...overrides,
    },
  };
}

test('endgame is a public fun command', () => {
  assert.equal(endgame.name, 'endgame');
  assert.equal(endgame.category, 'fun');
  assert.deepEqual(endgame.permissions, ['public']);
});

test('endgame reports when no game is running', async () => {
  const games = createGameManager();
  const { ctx, replies } = makeCtx(games);
  await endgame.execute(ctx);
  assert.match(replies[0], /NO ACTIVE GAME/);
});

test('endgame in a group: the starter, admins, owner and sudo may end it; others may not', async () => {
  const games = createGameManager();
  const start = () => games.start(GROUP, { type: 'trivia', game: makeGame(), starterJid: ADMIN });

  start();
  const denied = makeCtx(games);
  await assert.rejects(() => endgame.execute(denied.ctx), CommandError);
  assert.equal(games.hasSession(GROUP), true);

  for (const override of [
    { senderJid: ADMIN },
    { isAdmin: true },
    { isOwner: true },
    { isSudo: true },
  ]) {
    if (!games.hasSession(GROUP)) start();
    const { ctx, replies } = makeCtx(games, override);
    await endgame.execute(ctx);
    assert.equal(games.hasSession(GROUP), false, JSON.stringify(override));
    assert.match(replies[0], /GAME ENDED/);
    assert.match(replies[0], /trivia/);
  }
});

test('endgame recognises the starter across LID and phone forms', async () => {
  const groupMeta = {
    participants: [{ id: '5@lid', phoneNumber: '2348012345678@s.whatsapp.net' }, { id: MEMBER }],
  };
  const games = createGameManager();
  games.start(GROUP, { type: 'riddle', game: makeGame(), starterJid: '2348012345678@s.whatsapp.net' });

  const outsider = makeCtx(games, { groupMeta, senderJid: MEMBER });
  await assert.rejects(() => endgame.execute(outsider.ctx), CommandError);

  const starter = makeCtx(games, { groupMeta, senderJid: '5@lid' });
  await endgame.execute(starter.ctx);
  assert.equal(games.hasSession(GROUP), false);
});

test('endgame in a DM lets anyone end the game', async () => {
  const games = createGameManager();
  games.start(MEMBER, { type: 'rps', game: makeGame(), starterJid: ADMIN });
  const { ctx, replies } = makeCtx(games, { chatJid: MEMBER, isGroup: false, groupMeta: null, senderJid: MEMBER });
  await endgame.execute(ctx);
  assert.equal(games.hasSession(MEMBER), false);
  assert.match(replies[0], /GAME ENDED/);
});
