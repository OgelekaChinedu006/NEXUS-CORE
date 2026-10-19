import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createGameManager } from '../lib/games/manager.js';
import {
  WORD_CHAIN_TURN_MS,
  describeWordChainStart,
  describeWordChainStatus,
  joinWordChain,
  lastLetter,
  normalizeWord,
  parseWord,
  processWord,
  startWordChain,
  startsWithLetter,
} from '../lib/games/wordchain.js';
import { loadCommands } from '../lib/registry.js';
import { createLogger } from '../lib/logger.js';
import { CommandError } from '../lib/helpers.js';
import wordchainCommand from '../commands/fun/wordchain.js';

const ROOT = path.resolve(import.meta.dirname, '..');
const GROUP = '120363000000000000@g.us';
const OTHER_GROUP = '120363000000000001@g.us';
const MEMBER = '111@s.whatsapp.net';
const OTHER = '222@s.whatsapp.net';
const THIRD = '333@s.whatsapp.net';
const SPECTATOR = '444@s.whatsapp.net';
const silent = createLogger({ level: 'silent' });

function makeSocket() {
  const sent = [];
  return {
    sent,
    async sendMessage(jid, content, options) {
      sent.push({ jid, content, options });
      return { key: { id: `m${sent.length}` } };
    },
  };
}

function setup({ playerJids = [OTHER], turnTimeoutMs, groupMeta = null, starterJid = MEMBER } = {}) {
  const socket = makeSocket();
  const games = createGameManager({ getSocket: () => socket, logger: silent });
  const session = startWordChain(games, GROUP, {
    starterJid,
    playerJids,
    groupMeta,
    ...(turnTimeoutMs === undefined ? {} : { turnTimeoutMs }),
  });
  return { socket, games, session };
}

function say(games, text, { senderJid = MEMBER, groupMeta = null, chatJid = GROUP } = {}) {
  return games.handleText({ chatJid, senderJid, text, groupMeta, isGroup: true });
}

function makeCtx(games, overrides = {}) {
  const replies = [];
  return {
    replies,
    ctx: {
      games,
      sock: null,
      prefix: '!',
      args: [],
      argsText: '',
      chatJid: GROUP,
      isGroup: true,
      senderJid: MEMBER,
      targetJid: null,
      targetJids: [],
      groupMeta: null,
      reply: async (text, options = {}) => {
        replies.push({ text, options });
      },
      ...overrides,
    },
  };
}

test('parseWord accepts only a bare 3-32 letter word', () => {
  assert.equal(parseWord('cat'), 'cat');
  assert.equal(parseWord('  Apple '), 'Apple');
  assert.equal(parseWord('a'.repeat(32)), 'a'.repeat(32));
  for (const text of ['to', 'a'.repeat(33), 'cat!', 'two words', 'c4t', '', '   ', '123', null, undefined, 5]) {
    assert.equal(parseWord(text), null, String(text));
  }
});

test('normalizeWord, lastLetter and startsWithLetter are case-insensitive', () => {
  assert.equal(normalizeWord('Apple'), 'apple');
  assert.equal(lastLetter('CAT'), 't');
  assert.equal(startsWithLetter('Tiger', 't'), true);
  assert.equal(startsWithLetter('apple', 't'), false);
  assert.equal(startsWithLetter('', 'a'), false);
});

test('startWordChain registers a session with the starter first and a turn timer', () => {
  const { games, session } = setup();
  assert.equal(session.type, 'wordchain');
  assert.equal(session.starterJid, MEMBER);
  assert.equal(session.data.players[0].jid, MEMBER);
  assert.equal(session.data.players[1].jid, OTHER);
  assert.equal(session.data.turnIndex, 0);
  assert.equal(session.data.turnTimeoutMs, WORD_CHAIN_TURN_MS);
  assert.equal(session.data.lastWord, null);
  assert.equal(games.get(GROUP), session);
  assert.equal(session.timers.has('turn'), true);
  games.shutdown();
});

test('startWordChain supports an open seat when no extra players are supplied', () => {
  const { games, session } = setup({ playerJids: [] });
  assert.equal(session.data.players.length, 1);
  assert.match(describeWordChainStart(session), /join/i);
  games.shutdown();
});

test('startWordChain rejects existing games, missing players and invalid timeouts', () => {
  const games = createGameManager({ logger: silent });
  assert.throws(
    () => startWordChain(games, GROUP, { starterJid: null, playerJids: [] }),
    (error) => error instanceof CommandError && /at least one player/.test(error.message),
  );
  assert.equal(games.hasSession(GROUP), false);

  const running = startWordChain(games, GROUP, { starterJid: MEMBER, playerJids: [OTHER] });
  assert.throws(
    () => startWordChain(games, GROUP, { starterJid: OTHER, playerJids: [THIRD] }),
    (error) => error instanceof CommandError && /already running/.test(error.message),
  );
  assert.equal(games.get(GROUP), running);
  games.shutdown();

  for (const turnTimeoutMs of [Number.NaN, -1, Infinity, '1000']) {
    assert.throws(
      () => startWordChain(games, GROUP, { starterJid: MEMBER, turnTimeoutMs }),
      TypeError,
      String(turnTimeoutMs),
    );
    assert.equal(games.hasSession(GROUP), false);
  }
});

test('start and status messages show players, the chain and whose turn it is', () => {
  const { session } = setup();
  const start = describeWordChainStart(session);
  assert.match(start, /WORD CHAIN/);
  assert.match(start, /@111/);
  assert.match(start, /@222/);
  assert.match(start, /TURN:/);

  processWord(session, 'cat', MEMBER);
  const status = describeWordChainStatus(session);
  assert.match(status, /IN PROGRESS/);
  assert.match(status, /cat/);
  assert.match(status, /"T"/);
  assert.match(status, /@222/);
});

test('the current player is recognised through LID and phone aliases', () => {
  const groupMeta = {
    participants: [{ id: '5@lid', phoneNumber: '2348012345678@s.whatsapp.net' }, { id: OTHER }],
  };
  const { games, session, socket } = setup({ starterJid: '5@lid', groupMeta });
  assert.equal(session.data.players[0].jid, '5@lid');

  return say(games, 'apple', { senderJid: '2348012345678@s.whatsapp.net', groupMeta }).then(() => {
    assert.equal(session.data.lastWord, 'apple');
    assert.equal(session.data.turnIndex, 1);
    assert.equal(socket.sent.length, 1);
  });
});

test('players alternate and each word must start with the previous last letter', async () => {
  const { games, session, socket } = setup();
  await say(games, 'cat', { senderJid: MEMBER });
  assert.equal(session.data.lastWord, 'cat');
  assert.equal(session.data.lastLetter, 't');
  assert.equal(session.data.turnIndex, 1);
  assert.match(socket.sent[0].content.text, /played "cat"/);
  assert.match(socket.sent[0].content.text, /TURN: @222/);
  assert.deepEqual(socket.sent[0].content.mentions, [MEMBER, OTHER]);

  await say(games, 'Tiger', { senderJid: OTHER });
  assert.equal(session.data.lastWord, 'tiger');
  assert.equal(session.data.lastLetter, 'r');
  assert.equal(session.data.turnIndex, 0);
  assert.equal(games.get(GROUP), session);
});

test('an out-of-turn player cannot play and a used or mismatched word is rejected', async () => {
  const { games, session, socket } = setup();
  await say(games, 'cat', { senderJid: MEMBER });

  await say(games, 'dog', { senderJid: MEMBER });
  assert.match(socket.sent[1].content.text, /NOT YOUR TURN/);
  assert.equal(session.data.lastWord, 'cat');
  assert.equal(session.data.turnIndex, 1);

  await say(games, 'apple', { senderJid: OTHER });
  assert.match(socket.sent[2].content.text, /INVALID/);
  assert.equal(session.data.lastWord, 'cat');

  await say(games, 'tonic', { senderJid: OTHER });
  await say(games, 'CAT', { senderJid: MEMBER });
  assert.match(socket.sent.at(-1).content.text, /USED/);
  assert.equal(session.data.lastWord, 'tonic');
  assert.equal(session.data.turnIndex, 0);
  assert.equal(games.get(GROUP), session);
});

test('spectators, chatter and invalid tokens are ignored', async () => {
  const { games, session, socket } = setup();
  for (const text of ['hello world', 'to', 'cat!', 'ok', '123', 'a'.repeat(33)]) {
    await say(games, text, { senderJid: SPECTATOR });
  }
  await say(games, 'cat', { senderJid: SPECTATOR });
  assert.equal(socket.sent.length, 0);
  assert.equal(session.data.chain.length, 0);
  assert.equal(games.get(GROUP), session);
});

test('two simultaneous words cannot both claim the turn', async () => {
  const { games, session } = setup();
  await Promise.all([
    say(games, 'cat', { senderJid: MEMBER }),
    say(games, 'dog', { senderJid: OTHER }),
  ]);
  assert.equal(session.data.chain.length, 1);
  assert.equal(session.data.lastWord, 'cat');
  assert.equal(session.data.turnIndex, 1);
  assert.equal(games.get(GROUP), session);
});

test('join adds a player without consuming a turn', async () => {
  const { games, session, socket } = setup({ playerJids: [] });
  await say(games, 'join', { senderJid: OTHER });
  assert.equal(session.data.players.length, 2);
  assert.equal(session.data.players[1].jid, OTHER);
  assert.equal(session.data.turnIndex, 0);
  assert.match(socket.sent[0].content.text, /@222 joined/);

  await say(games, 'cat', { senderJid: MEMBER });
  assert.equal(session.data.turnIndex, 1);
});

test('joinWordChain refuses current players and foreign sessions', () => {
  const { session } = setup({ playerJids: [] });
  assert.equal(joinWordChain(session, MEMBER), null);
  assert.equal(joinWordChain(null, OTHER), null);
  assert.equal(joinWordChain({ type: 'guess', ended: false, data: { players: [] } }, OTHER), null);
  assert.equal(joinWordChain(session, OTHER).kind, 'join');
  assert.equal(joinWordChain(session, OTHER), null);
});

test('processWord ignores ended, foreign and malformed sessions', () => {
  const { games, session } = setup();
  games.end(GROUP);
  assert.equal(processWord(session, 'cat', MEMBER), null);
  assert.equal(processWord(null, 'cat', MEMBER), null);
  assert.equal(processWord({ type: 'guess', ended: false, data: {} }, 'cat', MEMBER), null);
});

test('a game in one chat never accepts words from another chat', async () => {
  const { games, session } = setup();
  assert.equal(await say(games, 'cat', { senderJid: MEMBER, chatJid: OTHER_GROUP }), false);
  assert.equal(session.data.chain.length, 0);
  assert.equal(games.get(GROUP), session);
});

test('a turn timeout eliminates the current player and can award a win', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { games, socket } = setup({ turnTimeoutMs: 1000 });
  await say(games, 'cat', { senderJid: MEMBER });
  t.mock.timers.tick(999);
  assert.equal(games.hasSession(GROUP), true);
  t.mock.timers.tick(1);
  await Promise.resolve();
  assert.equal(games.hasSession(GROUP), false);
  assert.match(socket.sent.at(-1).content.text, /VICTORY/);
  assert.match(socket.sent.at(-1).content.text, /@111 wins/);
});

test('a timeout before any word cancels when only one player would remain', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { games, socket } = setup({ turnTimeoutMs: 1000 });
  t.mock.timers.tick(1000);
  await Promise.resolve();
  assert.equal(games.hasSession(GROUP), false);
  assert.match(socket.sent[0].content.text, /CANCELLED|TIMED OUT/);
});

test('a timeout with three players continues the chain', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { games, session, socket } = setup({ playerJids: [OTHER, THIRD], turnTimeoutMs: 1000 });
  t.mock.timers.tick(1000);
  await Promise.resolve();
  assert.equal(games.get(GROUP), session);
  assert.equal(session.data.players.length, 2);
  assert.equal(session.data.players[0].jid, OTHER);
  assert.match(socket.sent[0].content.text, /TIMED OUT/);
  assert.match(socket.sent[0].content.text, /@111/);
});

test('a valid word restarts the turn deadline', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { games, socket } = setup({ turnTimeoutMs: 1000 });
  t.mock.timers.tick(800);
  await say(games, 'cat', { senderJid: MEMBER });
  t.mock.timers.tick(800);
  assert.equal(games.hasSession(GROUP), true);
  t.mock.timers.tick(200);
  await Promise.resolve();
  assert.equal(games.hasSession(GROUP), false);
  assert.match(socket.sent.at(-1).content.text, /VICTORY|TIMED OUT|CANCELLED/);
});

test('an invalid word does not reset the turn deadline', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { games, session, socket } = setup({ turnTimeoutMs: 1000 });
  await say(games, 'cat', { senderJid: MEMBER });
  t.mock.timers.tick(800);
  await say(games, 'apple', { senderJid: OTHER });
  assert.match(socket.sent.at(-1).content.text, /INVALID/);
  assert.equal(session.data.turnIndex, 1);
  t.mock.timers.tick(200);
  await Promise.resolve();
  assert.equal(games.hasSession(GROUP), false);
});

test('ending or replacing a session prevents its old timer from firing', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { games, socket } = setup({ turnTimeoutMs: 1000 });
  games.end(GROUP);
  const replacement = startWordChain(games, GROUP, {
    starterJid: OTHER,
    playerJids: [THIRD],
    turnTimeoutMs: 2000,
  });
  t.mock.timers.tick(1000);
  await Promise.resolve();
  assert.equal(socket.sent.length, 0);
  assert.equal(games.get(GROUP), replacement);

  t.mock.timers.tick(1000);
  await Promise.resolve();
  assert.equal(games.hasSession(GROUP), false);
});

test('a non-player leaving does not disturb the game', async () => {
  const { games, session, socket } = setup();
  assert.equal(await games.handlePlayerLeave(GROUP, SPECTATOR), true);
  assert.equal(games.get(GROUP), session);
  assert.equal(socket.sent.length, 0);
});

test('a player leaving after a word awards the remaining player the win', async () => {
  const { games, socket } = setup();
  await say(games, 'cat', { senderJid: MEMBER });
  assert.equal(await games.handlePlayerLeave(GROUP, OTHER), true);
  assert.equal(games.hasSession(GROUP), false);
  assert.match(socket.sent.at(-1).content.text, /VICTORY/);
  assert.match(socket.sent.at(-1).content.text, /@111 wins/);
});

test('the starter leaving an open unused game cancels it', async () => {
  const { games, socket } = setup({ playerJids: [] });
  await games.handlePlayerLeave(GROUP, MEMBER);
  assert.equal(games.hasSession(GROUP), false);
  assert.match(socket.sent[0].content.text, /CANCELLED/);
});

test('a departure is matched through aliases even after metadata no longer lists the player', async () => {
  const groupMeta = {
    participants: [{ id: '5@lid', phoneNumber: '2348012345678@s.whatsapp.net' }, { id: OTHER }],
  };
  const { games, socket } = setup({ starterJid: '5@lid', groupMeta });
  await say(games, 'cat', { senderJid: '5@lid', groupMeta });
  const afterRemoval = { participants: [{ id: OTHER }] };
  assert.equal(
    await games.handlePlayerLeave(GROUP, '2348012345678@s.whatsapp.net', { groupMeta: afterRemoval }),
    true,
  );
  assert.equal(games.hasSession(GROUP), false);
  assert.match(socket.sent.at(-1).content.text, /VICTORY/);
  assert.match(socket.sent.at(-1).content.text, /@222 wins/);
});

test('a non-current player leaving keeps the current turn', async () => {
  const { games, session } = setup({ playerJids: [OTHER, THIRD] });
  await games.handlePlayerLeave(GROUP, THIRD);
  assert.equal(games.get(GROUP), session);
  assert.equal(session.data.players.length, 2);
  assert.equal(session.data.turnIndex, 0);
  assert.equal(session.data.players[0].jid, MEMBER);
});

test('departures only affect the matching chat and game', async () => {
  const { games, session } = setup();
  const other = startWordChain(games, OTHER_GROUP, { starterJid: SPECTATOR, playerJids: [OTHER] });
  assert.equal(await games.handlePlayerLeave(OTHER_GROUP, OTHER), true);
  assert.equal(games.get(GROUP), session);
  assert.equal(games.hasSession(OTHER_GROUP), false);
  assert.ok(other.ended);
});

test('wordchain is a public fun command with the wc alias', async () => {
  assert.equal(wordchainCommand.name, 'wordchain');
  assert.deepEqual(wordchainCommand.aliases, ['wc']);
  assert.equal(wordchainCommand.category, 'fun');
  assert.deepEqual(wordchainCommand.permissions, ['public']);

  const registry = await loadCommands(path.join(ROOT, 'commands'), silent);
  assert.equal(registry.get('wordchain'), registry.get('wc'));
  assert.equal(registry.get('wc').category, 'fun');
  assert.match(registry.get('wc').source, /commands[\\/]fun[\\/]wordchain\.js$/);
});

test('the command starts a game with mentioned players', async () => {
  const games = createGameManager({ logger: silent });
  const { ctx, replies } = makeCtx(games, { targetJid: OTHER, targetJids: [OTHER] });
  await wordchainCommand.execute(ctx);
  const session = games.get(GROUP);
  assert.equal(session.type, 'wordchain');
  assert.equal(session.data.players[0].jid, MEMBER);
  assert.equal(session.data.players[1].jid, OTHER);
  assert.match(replies[0].text, /WORD CHAIN/);
  assert.deepEqual(replies[0].options.mentions, [MEMBER, OTHER]);
  games.shutdown();
});

test('the command starts an open game when no target is supplied', async () => {
  const games = createGameManager({ logger: silent });
  const { ctx, replies } = makeCtx(games);
  await wordchainCommand.execute(ctx);
  assert.equal(games.get(GROUP).data.players.length, 1);
  assert.match(replies[0].text, /join/i);
  games.shutdown();
});

test('the command shows status, plays words and validates input while a game runs', async () => {
  const { games, session } = setup();
  const status = makeCtx(games);
  await wordchainCommand.execute(status.ctx);
  assert.match(status.replies[0].text, /IN PROGRESS/);

  const move = makeCtx(games, { args: ['cat'], argsText: 'cat' });
  await wordchainCommand.execute(move.ctx);
  assert.equal(session.data.lastWord, 'cat');
  assert.match(move.replies[0].text, /played "cat"/);

  const invalid = makeCtx(games, { args: ['no'], argsText: 'no' });
  await assert.rejects(() => wordchainCommand.execute(invalid.ctx), CommandError);

  const spectator = makeCtx(games, { args: ['tree'], argsText: 'tree', senderJid: SPECTATOR });
  await assert.rejects(() => wordchainCommand.execute(spectator.ctx), CommandError);
  assert.equal(session.data.lastWord, 'cat');
  assert.equal(games.get(GROUP), session);
});

test('the command joins an open seat and refuses to start over another game', async () => {
  const { games } = setup({ playerJids: [] });
  const join = makeCtx(games, { args: ['join'], argsText: 'join', senderJid: OTHER });
  await wordchainCommand.execute(join.ctx);
  assert.equal(games.get(GROUP).data.players[1].jid, OTHER);

  const other = createGameManager({ logger: silent });
  other.start(GROUP, { type: 'trivia', game: { onText() {} }, starterJid: MEMBER });
  const { ctx } = makeCtx(other, { targetJid: OTHER });
  await assert.rejects(
    () => wordchainCommand.execute(ctx),
    (error) => error instanceof CommandError && /already running/.test(error.message),
  );
  assert.equal(other.get(GROUP).type, 'trivia');
  other.shutdown();
});

test('the command fails cleanly without a game engine', async () => {
  const { ctx } = makeCtx(null);
  await assert.rejects(() => wordchainCommand.execute(ctx), CommandError);
});

test('the command works in a direct chat with an open seat', async () => {
  const games = createGameManager({ logger: silent });
  const { ctx } = makeCtx(games, { chatJid: MEMBER, isGroup: false });
  await wordchainCommand.execute(ctx);
  assert.equal(games.get(MEMBER).type, 'wordchain');
  assert.equal(games.get(MEMBER).data.players.length, 1);
  games.shutdown();
});
