import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createGameManager } from '../lib/games/manager.js';
import {
  HANGMAN_IDLE_MS,
  HANGMAN_MAX_ATTEMPTS,
  HANGMAN_WORDS,
  describeHangmanStart,
  describeHangmanStatus,
  hangmanGame,
  isHangmanLetter,
  isHangmanWord,
  isQuitCommand,
  isStatusCommand,
  isWordRevealed,
  maskWord,
  parseHangmanLetter,
  processHangman,
  quitHangman,
  startHangman,
} from '../lib/games/hangman.js';
import { loadCommands } from '../lib/registry.js';
import { createLogger } from '../lib/logger.js';
import { CommandError } from '../lib/helpers.js';
import hangman from '../commands/fun/hangman.js';

const ROOT = path.resolve(import.meta.dirname, '..');
const GROUP = '120363000000000000@g.us';
const OTHER_GROUP = '120363000000000001@g.us';
const MEMBER = '111@s.whatsapp.net';
const OTHER = '222@s.whatsapp.net';
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

function setup({ answer = 'apple', idleMs, maxAttempts } = {}) {
  const socket = makeSocket();
  const games = createGameManager({ getSocket: () => socket, logger: silent });
  const session = startHangman(games, GROUP, {
    starterJid: MEMBER,
    answer,
    ...(idleMs === undefined ? {} : { idleMs }),
    ...(maxAttempts === undefined ? {} : { maxAttempts }),
  });
  return { socket, games, session };
}

function say(games, text, { senderJid = MEMBER, chatJid = GROUP } = {}) {
  return games.handleText({ chatJid, senderJid, text });
}

function makeCtx(games, overrides = {}) {
  const replies = [];
  return {
    replies,
    ctx: {
      games,
      prefix: '!',
      args: [],
      argsText: '',
      chatJid: GROUP,
      isGroup: true,
      senderJid: MEMBER,
      reply: async (text, options = {}) => {
        replies.push({ text, options });
      },
      ...overrides,
    },
  };
}

test('parseHangmanLetter accepts only a bare letter', () => {
  assert.equal(parseHangmanLetter('a'), 'a');
  assert.equal(parseHangmanLetter('  B '), 'b');
  assert.equal(parseHangmanLetter('Z'), 'z');
  for (const text of ['ab', 'apple', '1', '', '   ', 'a!', null, undefined, 5]) {
    assert.equal(parseHangmanLetter(text), null, String(text));
  }
});

test('isHangmanWord, isHangmanLetter and command helpers', () => {
  assert.equal(isHangmanWord('apple'), true);
  assert.equal(isHangmanWord('APPLE'), true);
  assert.equal(isHangmanWord(' rune '), true);
  assert.equal(isHangmanWord('cat'), false);
  assert.equal(isHangmanWord('abcdefghijk'), false);
  assert.equal(isHangmanWord('ap ple'), false);
  assert.equal(isHangmanLetter('a'), true);
  assert.equal(isHangmanLetter(' A '), true);
  assert.equal(isHangmanLetter('ab'), false);
  assert.equal(isQuitCommand('quit'), true);
  assert.equal(isQuitCommand(' STOP '), true);
  assert.equal(isQuitCommand('end'), true);
  assert.equal(isQuitCommand('a'), false);
  assert.equal(isStatusCommand('status'), true);
  assert.equal(isStatusCommand(' STATUS '), true);
  assert.equal(isStatusCommand('quit'), false);
});

test('the built-in word list contains only unique 4-10 letter words', () => {
  assert.ok(HANGMAN_WORDS.length >= 280);
  assert.ok(HANGMAN_WORDS.length <= 320);
  const seen = new Set();
  for (const word of HANGMAN_WORDS) {
    assert.equal(isHangmanWord(word), true, word);
    assert.equal(/^[a-z]{4,10}$/.test(word), true, word);
    assert.equal(seen.has(word), false, word);
    seen.add(word);
  }
});

test('startHangman without an answer picks from the bank using the given random source', () => {
  const games = createGameManager({ logger: silent });
  const first = startHangman(games, GROUP, { starterJid: MEMBER, random: () => 0 });
  assert.equal(first.data.answer, HANGMAN_WORDS[0]);
  assert.equal(HANGMAN_WORDS.includes(first.data.answer), true);
  games.shutdown();

  const other = createGameManager({ logger: silent });
  const last = startHangman(other, OTHER_GROUP, { starterJid: MEMBER, random: () => 0.999999999 });
  assert.equal(last.data.answer, HANGMAN_WORDS[HANGMAN_WORDS.length - 1]);
  assert.equal(HANGMAN_WORDS.includes(last.data.answer), true);
  other.shutdown();
});

test('maskWord reveals every occurrence of guessed letters and hides the rest', () => {
  assert.equal(maskWord('apple', new Set()), '_ _ _ _ _');
  assert.equal(maskWord('apple', new Set(['p'])), '_ P P _ _');
  assert.equal(maskWord('apple', new Set(['a', 'p', 'l', 'e'])), 'A P P L E');
  assert.equal(maskWord('letter', new Set(['t'])), '_ _ T T _ _');
});

test('isWordRevealed is true only when every letter has been guessed', () => {
  assert.equal(isWordRevealed('apple', new Set(['a', 'p', 'l'])), false);
  assert.equal(isWordRevealed('apple', new Set(['a', 'p', 'l', 'e'])), true);
  assert.equal(isWordRevealed('letter', new Set(['l', 'e', 't', 'r'])), true);
});

test('startHangman registers a session with the chosen answer and starter', () => {
  const { games, session } = setup();
  assert.equal(session.type, 'hangman');
  assert.equal(session.data.answer, 'apple');
  assert.equal(session.data.attempts, 0);
  assert.equal(session.data.maxAttempts, HANGMAN_MAX_ATTEMPTS);
  assert.equal(session.starterJid, MEMBER);
  assert.equal(games.get(GROUP), session);
  assert.equal(session.timers.has('idle'), true);
  games.shutdown();
});

test('startHangman refuses to start while any game is running in the chat', () => {
  const { games } = setup();
  assert.throws(() => startHangman(games, GROUP, { starterJid: OTHER, answer: 'river' }), CommandError);
  games.shutdown();
});

test('startHangman rejects invalid answers, timeouts and attempt counts before registering', () => {
  const games = createGameManager({ logger: silent });
  assert.throws(() => startHangman(games, GROUP, { answer: 'no' }), TypeError);
  assert.equal(games.hasSession(GROUP), false);
  for (const idleMs of [Number.NaN, -1, Infinity, '1000']) {
    assert.throws(() => startHangman(games, GROUP, { answer: 'apple', idleMs }), TypeError, String(idleMs));
    assert.equal(games.hasSession(GROUP), false);
  }
  assert.throws(() => startHangman(games, GROUP, { answer: 'apple', maxAttempts: 0 }), TypeError);
  assert.equal(games.hasSession(GROUP), false);
  games.shutdown();
});

test('start and status messages explain the rules, blanks and remaining misses', () => {
  const { session } = setup();
  const start = describeHangmanStart(session, '!');
  assert.match(start, /HANGMAN/);
  assert.match(start, /5-letter/);
  assert.match(start, /6 misses/);
  assert.match(start, /!hangman/);
  assert.match(start, /_ _ _ _ _/);

  processHangman(session, 'p', MEMBER);
  const status = describeHangmanStatus(session);
  assert.match(status, /IN PROGRESS/);
  assert.match(status, /_ P P _ _/);
  assert.match(status, /0\/6/);
});

test('plain chat and invalid tokens are ignored and cost no miss', async () => {
  const { games, socket, session } = setup();
  for (const text of ['hello everyone', 'apple', 'ab', '1', 'a!', 'aa']) {
    assert.equal(await say(games, text), true);
  }
  assert.equal(socket.sent.length, 0);
  assert.equal(session.data.attempts, 0);
});

test('a correct letter reveals every occurrence without consuming a miss', async () => {
  const { games, socket, session } = setup();
  await say(games, 'p');
  assert.match(socket.sent[0].content.text, /HIT/);
  assert.match(socket.sent[0].content.text, /_ P P _ _/);
  assert.equal(session.data.attempts, 0);
  assert.equal(session.data.guessed.has('p'), true);
  assert.equal(games.get(GROUP), session);
});

test('an incorrect letter consumes a miss and advances the figure', async () => {
  const { games, socket, session } = setup();
  await say(games, 'z');
  assert.match(socket.sent[0].content.text, /MISS/);
  assert.match(socket.sent[0].content.text, /1\/6/);
  assert.equal(session.data.attempts, 1);
  assert.match(socket.sent[0].content.text, /O {3}\|/);
});

test('a repeated letter is reported and does not consume a miss', async () => {
  const { games, socket, session } = setup();
  await say(games, 'p');
  await say(games, 'P');
  assert.match(socket.sent[1].content.text, /ALREADY TRIED/);
  assert.equal(session.data.attempts, 0);
  await say(games, 'z');
  await say(games, 'z');
  assert.match(socket.sent[3].content.text, /ALREADY TRIED/);
  assert.equal(session.data.attempts, 1);
});

test('revealing the last letter wins, mentions the winner and ends the session', async () => {
  const { games, socket, session } = setup();
  await say(games, 'a');
  await say(games, 'p');
  await say(games, 'l');
  await say(games, 'e', { senderJid: OTHER });
  const win = socket.sent[3];
  assert.match(win.content.text, /SOLVED/);
  assert.match(win.content.text, /APPLE/);
  assert.deepEqual(win.content.mentions, [OTHER]);
  assert.equal(session.data.attempts, 0);
  assert.equal(games.hasSession(GROUP), false);
  assert.equal(await say(games, 'a'), false);
});

test('using every miss without revealing the word ends the game and reveals it', async () => {
  const { games, socket } = setup();
  for (const letter of ['z', 'y', 'x', 'q', 'k', 'n']) {
    await say(games, letter);
  }
  assert.equal(socket.sent.length, 6);
  assert.match(socket.sent[5].content.text, /HANGED/);
  assert.match(socket.sent[5].content.text, /APPLE/);
  assert.equal(games.hasSession(GROUP), false);
});

test('a hit on the last remaining miss can still win', async () => {
  const { games, socket } = setup({ maxAttempts: 1 });
  await say(games, 'z');
  assert.match(socket.sent[0].content.text, /HANGED/);
  assert.equal(games.hasSession(GROUP), false);

  const second = setup({ maxAttempts: 2 });
  await say(second.games, 'z');
  await say(second.games, 'a');
  await say(second.games, 'p');
  await say(second.games, 'l');
  await say(second.games, 'e');
  assert.match(second.socket.sent.at(-1).content.text, /SOLVED/);
  assert.match(second.socket.sent.at(-1).content.text, /1\/2/);
});

test('two simultaneous winning letters produce exactly one win', async () => {
  const { games, socket } = setup();
  await say(games, 'a');
  await say(games, 'p');
  await say(games, 'l');
  await Promise.all([
    say(games, 'e', { senderJid: MEMBER }),
    say(games, 'e', { senderJid: OTHER }),
  ]);
  const wins = socket.sent.filter((item) => /SOLVED/.test(item.content.text));
  assert.equal(wins.length, 1);
});

test('processHangman is a no-op for ended or foreign sessions', () => {
  const { games, session } = setup();
  games.end(GROUP);
  assert.equal(processHangman(session, 'a', MEMBER), null);
  assert.equal(processHangman(null, 'a', MEMBER), null);
  assert.equal(processHangman({ type: 'guess', ended: false, data: {} }, 'a', MEMBER), null);
});

test('hangmanGame ignores non-letter input directly', async () => {
  const { session, socket } = setup();
  await hangmanGame.onText(session, { text: 'hi', senderJid: MEMBER }, session.api);
  await hangmanGame.onText(session, undefined, session.api);
  assert.equal(socket.sent.length, 0);
});

test('a game in one chat never accepts letters from another chat', async () => {
  const { games, session } = setup();
  assert.equal(await say(games, 'a', { chatJid: OTHER_GROUP }), false);
  assert.equal(session.data.attempts, 0);
  assert.equal(session.data.guessed.size, 0);
  assert.equal(games.get(GROUP), session);
});

test('quitHangman ends the session and reveals the answer', () => {
  const { games, session } = setup();
  const outcome = quitHangman(session, MEMBER);
  assert.equal(outcome.kind, 'quit');
  assert.match(outcome.text, /QUIT/);
  assert.match(outcome.text, /APPLE/);
  assert.deepEqual(outcome.mentions, [MEMBER]);
  assert.equal(games.hasSession(GROUP), false);
  assert.equal(quitHangman(session, MEMBER), null);
});

test('an idle game times out, reveals the word and frees the chat', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { games, socket } = setup();
  t.mock.timers.tick(HANGMAN_IDLE_MS - 1);
  assert.equal(games.hasSession(GROUP), true);
  t.mock.timers.tick(1);
  await Promise.resolve();
  assert.equal(games.hasSession(GROUP), false);
  assert.equal(socket.sent.length, 1);
  assert.match(socket.sent[0].content.text, /TIMED OUT/);
  assert.match(socket.sent[0].content.text, /APPLE/);
});

test('each valid guess restarts the inactivity timer', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { games, socket } = setup();
  t.mock.timers.tick(HANGMAN_IDLE_MS - 1000);
  await say(games, 'p');
  t.mock.timers.tick(HANGMAN_IDLE_MS - 1000);
  assert.equal(games.hasSession(GROUP), true);
  t.mock.timers.tick(1000);
  await Promise.resolve();
  assert.equal(games.hasSession(GROUP), false);
  assert.match(socket.sent.at(-1).content.text, /TIMED OUT/);
});

test('ignored chatter does not restart the inactivity timer', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { games } = setup();
  t.mock.timers.tick(HANGMAN_IDLE_MS - 1000);
  await say(games, 'just chatting');
  t.mock.timers.tick(1000);
  assert.equal(games.hasSession(GROUP), false);
});

test('ending or winning cancels the timeout notice', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const ended = setup();
  ended.games.end(GROUP);
  t.mock.timers.tick(HANGMAN_IDLE_MS * 2);
  await Promise.resolve();
  assert.equal(ended.socket.sent.length, 0);

  const won = setup();
  await say(won.games, 'a');
  await say(won.games, 'p');
  await say(won.games, 'l');
  await say(won.games, 'e');
  t.mock.timers.tick(HANGMAN_IDLE_MS * 2);
  await Promise.resolve();
  assert.match(won.socket.sent.at(-1).content.text, /SOLVED/);
  assert.equal(won.socket.sent.filter((item) => /TIMED OUT/.test(item.content.text)).length, 0);
});

test('hangman is a public fun command with the hm alias', async () => {
  assert.equal(hangman.name, 'hangman');
  assert.deepEqual(hangman.aliases, ['hm']);
  assert.equal(hangman.category, 'fun');
  assert.deepEqual(hangman.permissions, ['public']);

  const registry = await loadCommands(path.join(ROOT, 'commands'), silent);
  assert.equal(registry.get('hangman'), registry.get('hm'));
  assert.equal(registry.get('hm').category, 'fun');
  assert.match(registry.get('hm').source, /commands[\\/]fun[\\/]hangman\.js$/);
});

test('!hangman starts a game, records the starter and explains the rules', async () => {
  const games = createGameManager({ logger: silent });
  const { ctx, replies } = makeCtx(games);
  await hangman.execute(ctx);
  const session = games.get(GROUP);
  assert.equal(session.type, 'hangman');
  assert.equal(session.starterJid, MEMBER);
  assert.equal(isHangmanWord(session.data.answer), true);
  assert.match(replies[0].text, /HANGMAN/);
  assert.match(replies[0].text, /letter/);
  assert.match(replies[0].text, /!hangman <letter>/);
  games.shutdown();
});

test('!hangman with no argument while a game runs shows its status', async () => {
  const { games, session } = setup();
  const { ctx, replies } = makeCtx(games);
  await hangman.execute(ctx);
  assert.match(replies[0].text, /IN PROGRESS/);
  assert.equal(session.data.attempts, 0);
  assert.equal(games.get(GROUP), session);
});

test('!hangman status shows blanks without consuming a miss', async () => {
  const { games, session } = setup();
  processHangman(session, 'p', MEMBER);
  const { ctx, replies } = makeCtx(games, { args: ['status'], argsText: 'status' });
  await hangman.execute(ctx);
  assert.match(replies[0].text, /IN PROGRESS/);
  assert.match(replies[0].text, /_ P P _ _/);
  assert.equal(session.data.attempts, 0);
});

test('!hangman <letter> plays a guess in the running game', async () => {
  const { games, session } = setup();
  const hit = makeCtx(games, { args: ['p'], argsText: 'p' });
  await hangman.execute(hit.ctx);
  assert.match(hit.replies[0].text, /HIT/);
  assert.equal(session.data.attempts, 0);

  const miss = makeCtx(games, { args: ['z'], argsText: 'z', senderJid: OTHER });
  await hangman.execute(miss.ctx);
  assert.match(miss.replies[0].text, /MISS/);
  assert.equal(session.data.attempts, 1);
});

test('!hangman rejects invalid guesses without consuming a miss', async () => {
  const { games, session } = setup();
  for (const arg of ['ab', 'apple', '1', 'a!', '']) {
    const { ctx } = makeCtx(games, { args: [arg], argsText: arg });
    await assert.rejects(() => hangman.execute(ctx), CommandError, arg);
  }
  assert.equal(session.data.attempts, 0);
  assert.equal(session.data.guessed.size, 0);
});

test('!hangman quit ends the game and reveals the answer', async () => {
  const { games } = setup();
  const { ctx, replies } = makeCtx(games, { args: ['quit'], argsText: 'quit' });
  await hangman.execute(ctx);
  assert.match(replies[0].text, /QUIT/);
  assert.match(replies[0].text, /APPLE/);
  assert.equal(games.hasSession(GROUP), false);
});

test('!hangman is refused while a different game is running, and leaves it untouched', async () => {
  const games = createGameManager({ logger: silent });
  const other = games.start(GROUP, { type: 'trivia', game: { onText() {} }, starterJid: MEMBER });
  const { ctx } = makeCtx(games, { args: ['a'], argsText: 'a' });
  await assert.rejects(() => hangman.execute(ctx), (error) => {
    assert.ok(error instanceof CommandError);
    assert.match(error.message, /already running/);
    return true;
  });
  assert.equal(games.get(GROUP), other);
});

test('!hangman fails cleanly when the game engine is missing', async () => {
  const { ctx } = makeCtx(null);
  await assert.rejects(() => hangman.execute(ctx), CommandError);
});

test('!hangman works in a direct chat', async () => {
  const games = createGameManager({ logger: silent });
  const { ctx } = makeCtx(games, { chatJid: MEMBER, isGroup: false });
  await hangman.execute(ctx);
  assert.equal(games.get(MEMBER).type, 'hangman');
  games.shutdown();
});
