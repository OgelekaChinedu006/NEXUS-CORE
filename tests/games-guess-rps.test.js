import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createGameManager } from '../lib/games/manager.js';
import {
  GUESS_IDLE_MS,
  guessGame,
  isInGuessRange,
  parseGuessText,
  processGuess,
  startGuess,
} from '../lib/games/guess.js';
import { loadCommands } from '../lib/registry.js';
import { createLogger } from '../lib/logger.js';
import { CommandError } from '../lib/helpers.js';
import guess from '../commands/fun/guess.js';
import rps from '../commands/fun/rps.js';

const ROOT = path.resolve(import.meta.dirname, '..');
const GROUP = '120363000000000000@g.us';
const MEMBER = '111@s.whatsapp.net';
const OTHER = '222@s.whatsapp.net';
const silent = createLogger({ level: 'silent' });

// randomInt(1, 100, () => 0.415) === 42
const ANSWER_42 = () => 0.415;

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

function setup({ random = ANSWER_42, idleMs, maxAttempts } = {}) {
  const socket = makeSocket();
  const games = createGameManager({ getSocket: () => socket, logger: silent });
  const session = startGuess(games, GROUP, {
    starterJid: MEMBER,
    random,
    ...(idleMs ? { idleMs } : {}),
    ...(maxAttempts ? { maxAttempts } : {}),
  });
  return { socket, games, session };
}

function say(games, text, senderJid = MEMBER) {
  return games.handleText({ chatJid: GROUP, senderJid, text });
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

// ── parsing helpers ─────────────────────────────────────────────────────────

test('parseGuessText accepts only a bare integer', () => {
  assert.equal(parseGuessText('42'), 42);
  assert.equal(parseGuessText('  7 '), 7);
  assert.equal(parseGuessText('007'), 7);
  for (const text of ['hello', '4 2', '12abc', '3.5', '-4', '', '   ', '1234567', null, undefined, 42]) {
    assert.equal(parseGuessText(text), null, String(text));
  }
});

test('isInGuessRange enforces integers from 1 to 100', () => {
  assert.equal(isInGuessRange(1), true);
  assert.equal(isInGuessRange(100), true);
  assert.equal(isInGuessRange(0), false);
  assert.equal(isInGuessRange(101), false);
  assert.equal(isInGuessRange(2.5), false);
  assert.equal(isInGuessRange(NaN), false);
});

// ── guess game ──────────────────────────────────────────────────────────────

test('startGuess registers a "guess" session with the chosen answer and the starter', () => {
  const { games, session } = setup();
  assert.equal(session.type, 'guess');
  assert.equal(session.data.answer, 42);
  assert.equal(session.data.attempts, 0);
  assert.equal(session.starterJid, MEMBER);
  assert.equal(games.get(GROUP), session);
});

test('startGuess refuses to start while any game is running in the chat', () => {
  const { games } = setup();
  assert.throws(() => startGuess(games, GROUP, { starterJid: OTHER }), CommandError);
});

test('random answers cover the full 1..100 range', () => {
  assert.equal(setup({ random: () => 0 }).session.data.answer, 1);
  assert.equal(setup({ random: () => 0.999999 }).session.data.answer, 100);
});

test('plain chat and out-of-range numbers are ignored and cost no attempt', async () => {
  const { games, socket, session } = setup();
  for (const text of ['hello everyone', '4 2', '0', '101', '5000', '3.5']) {
    assert.equal(await say(games, text), true); // routed to the session, but ignored by it
  }
  assert.equal(socket.sent.length, 0);
  assert.equal(session.data.attempts, 0);
});

test('low and high hints narrow the range and count attempts', async () => {
  const { games, socket, session } = setup();
  await say(games, '10');
  assert.match(socket.sent[0].content.text, /TOO LOW/);
  assert.match(socket.sent[0].content.text, /1\/7/);
  assert.match(socket.sent[0].content.text, /11 – 100/);

  await say(games, '90');
  assert.match(socket.sent[1].content.text, /TOO HIGH/);
  assert.match(socket.sent[1].content.text, /2\/7/);
  assert.match(socket.sent[1].content.text, /11 – 89/);

  await say(games, '5'); // below the known range still counts, but must not widen it
  assert.match(socket.sent[2].content.text, /11 – 89/);
  assert.equal(session.data.attempts, 3);
  assert.equal(socket.sent[0].jid, GROUP);
});

test('a repeated guess is reported and does not consume an attempt', async () => {
  const { games, socket, session } = setup();
  await say(games, '10');
  await say(games, '10');
  assert.match(socket.sent[1].content.text, /ALREADY TRIED/);
  assert.equal(session.data.attempts, 1);
});

test('a correct guess wins, mentions the winner and ends the session', async () => {
  const { games, socket } = setup();
  await say(games, '30');
  await say(games, '42', OTHER);
  const win = socket.sent[1];
  assert.match(win.content.text, /CORRECT/);
  assert.match(win.content.text, /42/);
  assert.match(win.content.text, /2\/7/);
  assert.deepEqual(win.content.mentions, [OTHER]);
  assert.equal(games.hasSession(GROUP), false);
  assert.equal(await say(games, '42'), false);
});

test('using every attempt without finding the number ends the game and reveals it', async () => {
  const { games, socket } = setup();
  for (const n of [1, 2, 3, 4, 5, 6, 7]) await say(games, String(n));
  assert.equal(socket.sent.length, 7);
  assert.match(socket.sent[6].content.text, /GAME OVER/);
  assert.match(socket.sent[6].content.text, /42/);
  assert.equal(games.hasSession(GROUP), false);
});

test('a guess on the last attempt can still win', async () => {
  const { games, socket } = setup();
  for (const n of [1, 2, 3, 4, 5, 6]) await say(games, String(n));
  await say(games, '42');
  assert.match(socket.sent[6].content.text, /CORRECT/);
  assert.match(socket.sent[6].content.text, /7\/7/);
});

test('two simultaneous winning guesses produce exactly one win', async () => {
  const { games, socket } = setup();
  await Promise.all([say(games, '42', MEMBER), say(games, '42', OTHER)]);
  assert.equal(socket.sent.length, 1);
  assert.match(socket.sent[0].content.text, /CORRECT/);
});

test('processGuess is a no-op for ended or foreign sessions', () => {
  const { games, session } = setup();
  games.end(GROUP);
  assert.equal(processGuess(session, 10, MEMBER), null);
  assert.equal(processGuess(null, 10, MEMBER), null);
  assert.equal(processGuess({ type: 'trivia', ended: false, data: {} }, 10, MEMBER), null);
});

test('guessGame ignores non-numeric input directly', async () => {
  const { session, socket } = setup();
  await guessGame.onText(session, { text: 'hi', senderJid: MEMBER }, session.api);
  await guessGame.onText(session, undefined, session.api);
  assert.equal(socket.sent.length, 0);
});

// ── inactivity timeout ──────────────────────────────────────────────────────

test('an idle guess game times out, reveals the number and frees the chat', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { games, socket } = setup();
  t.mock.timers.tick(GUESS_IDLE_MS - 1);
  assert.equal(games.hasSession(GROUP), true);
  t.mock.timers.tick(1);
  await Promise.resolve();
  assert.equal(games.hasSession(GROUP), false);
  assert.equal(socket.sent.length, 1);
  assert.match(socket.sent[0].content.text, /TIMED OUT/);
  assert.match(socket.sent[0].content.text, /42/);
});

test('each valid guess restarts the inactivity timer', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { games, socket } = setup();
  t.mock.timers.tick(GUESS_IDLE_MS - 1000);
  await say(games, '10');
  t.mock.timers.tick(GUESS_IDLE_MS - 1000);
  assert.equal(games.hasSession(GROUP), true);
  t.mock.timers.tick(1000);
  await Promise.resolve();
  assert.equal(games.hasSession(GROUP), false);
  assert.match(socket.sent.at(-1).content.text, /TIMED OUT/);
});

test('ignored chatter does not restart the inactivity timer', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { games } = setup();
  t.mock.timers.tick(GUESS_IDLE_MS - 1000);
  await say(games, 'just chatting');
  t.mock.timers.tick(1000);
  assert.equal(games.hasSession(GROUP), false);
});

test('ending the game cancels the timeout notice', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { games, socket } = setup();
  games.end(GROUP);
  t.mock.timers.tick(GUESS_IDLE_MS * 2);
  await Promise.resolve();
  assert.equal(socket.sent.length, 0);
});

test('winning cancels the timeout notice', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { games, socket } = setup();
  await say(games, '42');
  t.mock.timers.tick(GUESS_IDLE_MS * 2);
  await Promise.resolve();
  assert.equal(socket.sent.length, 1);
});

// ── guess command ───────────────────────────────────────────────────────────

test('guess is a public fun command', () => {
  assert.equal(guess.name, 'guess');
  assert.equal(guess.category, 'fun');
  assert.deepEqual(guess.permissions, ['public']);
});

test('!guess starts a game, records the starter and explains the rules', async () => {
  const games = createGameManager({ logger: silent });
  const { ctx, replies } = makeCtx(games);
  await guess.execute(ctx);
  const session = games.get(GROUP);
  assert.equal(session.type, 'guess');
  assert.equal(session.starterJid, MEMBER);
  assert.ok(isInGuessRange(session.data.answer));
  assert.match(replies[0].text, /GUESS THE NUMBER/);
  assert.match(replies[0].text, /1 and 100/);
  assert.match(replies[0].text, /7 attempts/);
  assert.match(replies[0].text, /!guess <number>/);
  games.shutdown();
});

test('!guess with no argument while a guess game runs shows its status', async () => {
  const { games, session } = setup();
  const { ctx, replies } = makeCtx(games);
  await guess.execute(ctx);
  assert.match(replies[0].text, /GUESS IN PROGRESS/);
  assert.equal(session.data.attempts, 0);
  assert.equal(games.get(GROUP), session);
});

test('!guess <n> plays a guess in the running game', async () => {
  const { games, session } = setup();
  const low = makeCtx(games, { args: ['10'], argsText: '10' });
  await guess.execute(low.ctx);
  assert.match(low.replies[0].text, /TOO LOW/);
  assert.equal(session.data.attempts, 1);

  const win = makeCtx(games, { args: ['42'], argsText: '42', senderJid: OTHER });
  await guess.execute(win.ctx);
  assert.match(win.replies[0].text, /CORRECT/);
  assert.deepEqual(win.replies[0].options.mentions, [OTHER]);
  assert.equal(games.hasSession(GROUP), false);
});

test('!guess rejects non-numeric and out-of-range arguments without consuming an attempt', async () => {
  const { games, session } = setup();
  for (const arg of ['abc', '0', '101', '3.5', '-5', '1e2']) {
    const { ctx } = makeCtx(games, { args: [arg], argsText: arg });
    await assert.rejects(() => guess.execute(ctx), CommandError, arg);
  }
  assert.equal(session.data.attempts, 0);
});

test('!guess is refused while a different game is running, and leaves it untouched', async () => {
  const games = createGameManager({ logger: silent });
  const other = games.start(GROUP, { type: 'trivia', game: { onText() {} }, starterJid: MEMBER });
  const { ctx } = makeCtx(games, { args: ['5'], argsText: '5' });
  await assert.rejects(() => guess.execute(ctx), (error) => {
    assert.ok(error instanceof CommandError);
    assert.match(error.message, /already running/);
    return true;
  });
  assert.equal(games.get(GROUP), other);
});

test('!guess fails cleanly when the game engine is missing', async () => {
  const { ctx } = makeCtx(null);
  await assert.rejects(() => guess.execute(ctx), CommandError);
});

test('!guess works in a direct chat', async () => {
  const games = createGameManager({ logger: silent });
  const { ctx } = makeCtx(games, { chatJid: MEMBER, isGroup: false });
  await guess.execute(ctx);
  assert.equal(games.get(MEMBER).type, 'guess');
  games.shutdown();
});

// ── rps command ─────────────────────────────────────────────────────────────

// Math.random is mocked once per test; `rng.value` is what pick() will see:
// 0 -> rock, 0.4 -> paper, 0.9 -> scissors.
function rpsHarness(t) {
  const rng = { value: 0 };
  t.mock.method(Math, 'random', () => rng.value);
  const games = createGameManager({ logger: silent });
  async function play(arg, overrides = {}) {
    const { ctx, replies } = makeCtx(games, {
      args: arg === undefined ? [] : [arg],
      argsText: arg ?? '',
      ...overrides,
    });
    await rps.execute(ctx);
    return replies;
  }
  function ctxFor(arg) {
    return makeCtx(games, { args: arg === undefined ? [] : [arg], argsText: arg ?? '' }).ctx;
  }
  return { rng, games, play, ctxFor };
}

test('rps is a public fun command', () => {
  assert.equal(rps.name, 'rps');
  assert.equal(rps.category, 'fun');
  assert.deepEqual(rps.permissions, ['public']);
});

test('rps resolves every player/bot pairing correctly', async (t) => {
  const { rng, play } = rpsHarness(t);
  const bots = [[0, 'rock'], [0.4, 'paper'], [0.9, 'scissors']];
  const outcome = {
    rock: { rock: 'draw', paper: 'bot', scissors: 'player' },
    paper: { rock: 'player', paper: 'draw', scissors: 'bot' },
    scissors: { rock: 'bot', paper: 'player', scissors: 'draw' },
  };
  for (const player of ['rock', 'paper', 'scissors']) {
    for (const [value, bot] of bots) {
      rng.value = value;
      const text = (await play(player))[0].text;
      const label = `${player} vs ${bot}`;
      assert.match(text, new RegExp(`YOU: ${player}`), label);
      assert.match(text, new RegExp(`BOT: ${bot}`), label);
      if (outcome[player][bot] === 'draw') {
        assert.match(text, /A draw/, label);
        assert.doesNotMatch(text, /wins\./, label);
      } else if (outcome[player][bot] === 'player') {
        assert.match(text, /@111 wins\./, label);
        assert.doesNotMatch(text, /bot wins/i, label);
      } else {
        assert.match(text, /The bot wins\./, label);
        assert.doesNotMatch(text, /@111 wins/, label);
      }
    }
  }
});

test('rps accepts case-insensitive names, single letters and emoji', async (t) => {
  const { play } = rpsHarness(t);
  for (const [arg, label] of [
    ['ROCK', 'rock'], ['Paper', 'paper'], ['r', 'rock'], ['p', 'paper'], ['s', 'scissors'],
    ['✊', 'rock'], ['✋', 'paper'], ['✌️', 'scissors'], ['✌', 'scissors'],
  ]) {
    const text = (await play(arg))[0].text;
    assert.match(text, new RegExp(`YOU: ${label}`), arg);
  }
});

test('rps mentions the sender', async (t) => {
  const { play } = rpsHarness(t);
  const replies = await play('rock');
  assert.deepEqual(replies[0].options.mentions, [MEMBER]);
});

test('rps rejects a missing or invalid choice and never treats prototype keys as choices', async (t) => {
  const { ctxFor } = rpsHarness(t);
  for (const arg of [undefined, 'lizard', 'constructor', '__proto__', 'toString', '']) {
    await assert.rejects(() => rps.execute(ctxFor(arg)), CommandError, String(arg));
  }
});

test('rps is a one-shot: it creates no session and does not disturb a running game', async (t) => {
  const { games, play } = rpsHarness(t);
  await play('rock');
  assert.equal(games.hasSession(GROUP), false);

  const running = games.start(GROUP, { type: 'trivia', game: { onText() {} }, starterJid: MEMBER });
  const replies = await play('paper');
  assert.equal(replies.length, 1);
  assert.equal(games.get(GROUP), running);
});

// ── registry ────────────────────────────────────────────────────────────────

test('registry loads rps, guess and endgame together without name or alias conflicts', async () => {
  const registry = await loadCommands(path.join(ROOT, 'commands'), silent);
  for (const name of ['rps', 'guess', 'endgame']) {
    const command = registry.get(name);
    assert.ok(command, `missing command: ${name}`);
    assert.equal(command.category, 'fun');
  }
  assert.match(registry.get('guess').source, /commands[\\/]fun[\\/]guess\.js$/);
});
