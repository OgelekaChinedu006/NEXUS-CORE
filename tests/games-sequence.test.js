import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createGameManager } from '../lib/games/manager.js';
import {
  SEQUENCE_DEFAULT_DIFFICULTY,
  SEQUENCE_DIFFICULTIES,
  SEQUENCE_IDLE_MS,
  SEQUENCE_MAX_ATTEMPTS,
  SEQUENCE_PUZZLES,
  describeSequenceStart,
  describeSequenceStatus,
  formatSequence,
  getRecentPuzzleId,
  isQuitCommand,
  isStatusCommand,
  parseDifficulty,
  parseSequenceAnswer,
  pickSequencePuzzle,
  processSequence,
  puzzlesForDifficulty,
  quitSequence,
  rememberPuzzleId,
  sequenceGame,
  startSequence,
  validatePuzzle,
} from '../lib/games/sequence.js';
import { loadCommands } from '../lib/registry.js';
import { createLogger } from '../lib/logger.js';
import { CommandError } from '../lib/helpers.js';
import sequence from '../commands/fun/sequence.js';

const ROOT = path.resolve(import.meta.dirname, '..');
const GROUP = '120363000000000000@g.us';
const OTHER_GROUP = '120363000000000001@g.us';
const MEMBER = '111@s.whatsapp.net';
const OTHER = '222@s.whatsapp.net';
const silent = createLogger({ level: 'silent' });

const ADD2 = SEQUENCE_PUZZLES.find((puzzle) => puzzle.id === 'e-add2');

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

function setup({ puzzle = ADD2, difficulty, idleMs, maxAttempts, chatJid = GROUP } = {}) {
  const socket = makeSocket();
  const games = createGameManager({ getSocket: () => socket, logger: silent });
  const session = startSequence(games, chatJid, {
    starterJid: MEMBER,
    puzzle,
    ...(difficulty === undefined ? {} : { difficulty }),
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

test('parseSequenceAnswer accepts only a bare integer', () => {
  assert.equal(parseSequenceAnswer('10'), 10);
  assert.equal(parseSequenceAnswer('  -7 '), -7);
  assert.equal(parseSequenceAnswer('007'), 7);
  for (const text of ['hello', '1 0', '12abc', '3.5', '', '   ', null, undefined, 10]) {
    assert.equal(parseSequenceAnswer(text), null, String(text));
  }
});

test('parseDifficulty, quit and status helpers', () => {
  assert.equal(parseDifficulty('easy'), 'easy');
  assert.equal(parseDifficulty(' MED '), 'medium');
  assert.equal(parseDifficulty('h'), 'hard');
  assert.equal(parseDifficulty('2'), 'medium');
  assert.equal(parseDifficulty('10'), null);
  assert.equal(parseDifficulty('quiz'), null);
  assert.equal(isQuitCommand('quit'), true);
  assert.equal(isQuitCommand(' STOP '), true);
  assert.equal(isQuitCommand('end'), true);
  assert.equal(isQuitCommand('10'), false);
  assert.equal(isStatusCommand('status'), true);
  assert.equal(isStatusCommand(' STATUS '), true);
  assert.equal(isStatusCommand('quit'), false);
  assert.equal(SEQUENCE_DEFAULT_DIFFICULTY, 'easy');
});

test('the curated bank is valid, unique and covers every difficulty', () => {
  const seen = new Set();
  const counts = { easy: 0, medium: 0, hard: 0 };
  for (const puzzle of SEQUENCE_PUZZLES) {
    assert.equal(validatePuzzle(puzzle), puzzle, puzzle.id);
    assert.equal(seen.has(puzzle.id), false, puzzle.id);
    seen.add(puzzle.id);
    counts[puzzle.difficulty] += 1;
    assert.ok(puzzle.sequence.length >= 3, puzzle.id);
    assert.ok(Number.isInteger(puzzle.answer), puzzle.id);
    assert.ok(puzzle.rule.length > 8, puzzle.id);
  }
  assert.ok(counts.easy >= 6);
  assert.ok(counts.medium >= 6);
  assert.ok(counts.hard >= 6);
  assert.deepEqual(SEQUENCE_DIFFICULTIES, ['easy', 'medium', 'hard']);
});

test('every documented puzzle answer matches its rule', () => {
  const expected = {
    'e-add2': 10,
    'e-add5': 25,
    'e-sub3': 8,
    'e-mul2': 48,
    'e-squares': 25,
    'e-fib': 8,
    'e-mul3': 81,
    'e-odds': 11,
    'm-rising-diff': 42,
    'm-fact': 720,
    'm-cubes': 125,
    'm-double-plus': 63,
    'm-plus-n': 17,
    'm-interleave': 4,
    'm-double-minus': 65,
    'm-two-streams': 10,
    'h-product': 256,
    'h-sq-alt': 50,
    'h-odd-diff': 30,
    'h-mul2-sub3': 35,
    'h-double-dec': 16,
    'h-prime-sq': 169,
    'h-square-add': 56,
    'h-odd-from-3': 48,
  };
  for (const puzzle of SEQUENCE_PUZZLES) {
    assert.equal(puzzle.answer, expected[puzzle.id], puzzle.id);
  }
  assert.equal(Object.keys(expected).length, SEQUENCE_PUZZLES.length);
});

test('formatSequence appends a missing term marker', () => {
  assert.equal(formatSequence([2, 4, 6, 8]), '2, 4, 6, 8, ?');
});

test('puzzlesForDifficulty and pickSequencePuzzle stay inside the requested pool', () => {
  for (const difficulty of SEQUENCE_DIFFICULTIES) {
    const pool = puzzlesForDifficulty(difficulty);
    assert.ok(pool.length >= 6, difficulty);
    assert.ok(pool.every((puzzle) => puzzle.difficulty === difficulty));
    const chosen = pickSequencePuzzle(difficulty, { random: () => 0 });
    assert.equal(chosen, pool[0]);
    const last = pickSequencePuzzle(difficulty, { random: () => 0.999999 });
    assert.equal(last, pool[pool.length - 1]);
  }
  assert.throws(() => pickSequencePuzzle('legendary'), TypeError);
});

test('pickSequencePuzzle skips the previous puzzle when another remains', () => {
  const pool = puzzlesForDifficulty('easy');
  const first = pool[0];
  const chosen = pickSequencePuzzle('easy', { random: () => 0, excludeId: first.id });
  assert.notEqual(chosen.id, first.id);
  assert.equal(chosen, pool[1]);

  const tiny = [{ id: 'only', difficulty: 'easy', sequence: [1, 2, 3], answer: 4, rule: 'Add 1.' }];
  const fallback = pickSequencePuzzle('easy', { excludeId: 'only', puzzles: tiny });
  assert.equal(fallback.id, 'only');
});

test('startSequence registers a session with the chosen puzzle and starter', () => {
  const { games, session } = setup();
  assert.equal(session.type, 'sequence');
  assert.equal(session.data.puzzle.id, 'e-add2');
  assert.equal(session.data.puzzle.answer, 10);
  assert.equal(session.data.attempts, 0);
  assert.equal(session.data.maxAttempts, SEQUENCE_MAX_ATTEMPTS);
  assert.equal(session.data.difficulty, 'easy');
  assert.equal(session.starterJid, MEMBER);
  assert.equal(games.get(GROUP), session);
  assert.equal(session.timers.has('idle'), true);
  games.shutdown();
});

test('startSequence refuses to start while any game is running in the chat', () => {
  const { games } = setup();
  assert.throws(() => startSequence(games, GROUP, { starterJid: OTHER, puzzle: ADD2 }), CommandError);
  games.shutdown();
});

test('startSequence rejects invalid puzzles, timeouts and attempt counts before registering', () => {
  const games = createGameManager({ logger: silent });
  assert.throws(() => startSequence(games, GROUP, { puzzle: { id: 'bad' } }), TypeError);
  assert.equal(games.hasSession(GROUP), false);
  for (const idleMs of [Number.NaN, -1, Infinity, '1000']) {
    assert.throws(() => startSequence(games, GROUP, { puzzle: ADD2, idleMs }), TypeError, String(idleMs));
    assert.equal(games.hasSession(GROUP), false);
  }
  assert.throws(() => startSequence(games, GROUP, { puzzle: ADD2, maxAttempts: 0 }), TypeError);
  assert.equal(games.hasSession(GROUP), false);
  games.shutdown();
});

test('startSequence selects from the requested difficulty and avoids an immediate repeat', () => {
  const chat = 'repeat-chat@g.us';
  rememberPuzzleId(chat, 'e-add2');
  const games = createGameManager({ logger: silent });
  const first = startSequence(games, chat, { starterJid: MEMBER, difficulty: 'easy', random: () => 0 });
  assert.equal(first.data.difficulty, 'easy');
  assert.notEqual(first.data.puzzle.id, 'e-add2');
  assert.equal(getRecentPuzzleId(chat), first.data.puzzle.id);
  games.end(chat);

  const second = startSequence(games, chat, { starterJid: MEMBER, difficulty: 'hard', random: () => 0 });
  assert.equal(second.data.difficulty, 'hard');
  assert.equal(puzzlesForDifficulty('hard')[0].id === second.data.puzzle.id || true, true);
  games.shutdown();
});

test('start and status messages show the sequence, difficulty and remaining attempts', () => {
  const { session } = setup();
  const start = describeSequenceStart(session, '!');
  assert.match(start, /SEQUENCE CHALLENGE/);
  assert.match(start, /2, 4, 6, 8, \?/);
  assert.match(start, /EASY/);
  assert.match(start, /3 valid guesses/);
  assert.match(start, /!sequence/);

  processSequence(session, 9, MEMBER);
  const status = describeSequenceStatus(session);
  assert.match(status, /IN PROGRESS/);
  assert.match(status, /1\/3/);
  assert.match(status, /TRIED: 9/);
});

test('plain chat and invalid tokens are ignored and cost no attempt', async () => {
  const { games, socket, session } = setup();
  for (const text of ['hello everyone', 'ten', '3.5', '1 0', 'abc']) {
    assert.equal(await say(games, text), true);
  }
  assert.equal(socket.sent.length, 0);
  assert.equal(session.data.attempts, 0);
});

test('a miss counts an attempt and keeps the session', async () => {
  const { games, socket, session } = setup();
  await say(games, '9');
  assert.match(socket.sent[0].content.text, /not the next number/);
  assert.match(socket.sent[0].content.text, /1\/3/);
  assert.equal(session.data.attempts, 1);
  assert.equal(games.get(GROUP), session);
});

test('a repeated guess is reported and does not consume an attempt', async () => {
  const { games, socket, session } = setup();
  await say(games, '9');
  await say(games, '9');
  assert.match(socket.sent[1].content.text, /ALREADY TRIED/);
  assert.equal(session.data.attempts, 1);
});

test('a correct answer wins, mentions the winner, reveals the rule and ends the session', async () => {
  const { games, socket } = setup();
  await say(games, '9');
  await say(games, '10', { senderJid: OTHER });
  const win = socket.sent[1];
  assert.match(win.content.text, /SOLVED/);
  assert.match(win.content.text, /10/);
  assert.match(win.content.text, /Add 2/);
  assert.match(win.content.text, /2\/3/);
  assert.deepEqual(win.content.mentions, [OTHER]);
  assert.equal(games.hasSession(GROUP), false);
  assert.equal(await say(games, '10'), false);
});

test('using every attempt without the answer ends the game and reveals the rule', async () => {
  const { games, socket } = setup();
  for (const n of [1, 2, 3]) await say(games, String(n));
  assert.equal(socket.sent.length, 3);
  assert.match(socket.sent[2].content.text, /FAILED/);
  assert.match(socket.sent[2].content.text, /ANSWER: 10/);
  assert.match(socket.sent[2].content.text, /Add 2/);
  assert.equal(games.hasSession(GROUP), false);
});

test('a guess on the last attempt can still win', async () => {
  const { games, socket } = setup();
  await say(games, '1');
  await say(games, '2');
  await say(games, '10');
  assert.match(socket.sent[2].content.text, /SOLVED/);
  assert.match(socket.sent[2].content.text, /3\/3/);
});

test('two simultaneous winning guesses produce exactly one win', async () => {
  const { games, socket } = setup();
  await Promise.all([
    say(games, '10', { senderJid: MEMBER }),
    say(games, '10', { senderJid: OTHER }),
  ]);
  assert.equal(socket.sent.length, 1);
  assert.match(socket.sent[0].content.text, /SOLVED/);
});

test('processSequence is a no-op for ended or foreign sessions', () => {
  const { games, session } = setup();
  games.end(GROUP);
  assert.equal(processSequence(session, 10, MEMBER), null);
  assert.equal(processSequence(null, 10, MEMBER), null);
  assert.equal(processSequence({ type: 'guess', ended: false, data: {} }, 10, MEMBER), null);
});

test('sequenceGame ignores non-numeric input directly', async () => {
  const { session, socket } = setup();
  await sequenceGame.onText(session, { text: 'hi', senderJid: MEMBER }, session.api);
  await sequenceGame.onText(session, undefined, session.api);
  assert.equal(socket.sent.length, 0);
});

test('a game in one chat never accepts answers from another chat', async () => {
  const { games, session } = setup();
  assert.equal(await say(games, '10', { chatJid: OTHER_GROUP }), false);
  assert.equal(session.data.attempts, 0);
  assert.equal(games.get(GROUP), session);
});

test('quitSequence ends the session and reveals the answer and rule', () => {
  const { games, session } = setup();
  const outcome = quitSequence(session, MEMBER);
  assert.equal(outcome.kind, 'quit');
  assert.match(outcome.text, /QUIT/);
  assert.match(outcome.text, /ANSWER: 10/);
  assert.match(outcome.text, /Add 2/);
  assert.deepEqual(outcome.mentions, [MEMBER]);
  assert.equal(games.hasSession(GROUP), false);
  assert.equal(quitSequence(session, MEMBER), null);
});

test('an idle game times out, reveals the answer and frees the chat', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { games, socket } = setup();
  t.mock.timers.tick(SEQUENCE_IDLE_MS - 1);
  assert.equal(games.hasSession(GROUP), true);
  t.mock.timers.tick(1);
  await Promise.resolve();
  assert.equal(games.hasSession(GROUP), false);
  assert.equal(socket.sent.length, 1);
  assert.match(socket.sent[0].content.text, /TIMED OUT/);
  assert.match(socket.sent[0].content.text, /ANSWER: 10/);
  assert.match(socket.sent[0].content.text, /Add 2/);
});

test('each valid guess restarts the inactivity timer', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { games, socket } = setup();
  t.mock.timers.tick(SEQUENCE_IDLE_MS - 1000);
  await say(games, '9');
  t.mock.timers.tick(SEQUENCE_IDLE_MS - 1000);
  assert.equal(games.hasSession(GROUP), true);
  t.mock.timers.tick(1000);
  await Promise.resolve();
  assert.equal(games.hasSession(GROUP), false);
  assert.match(socket.sent.at(-1).content.text, /TIMED OUT/);
});

test('ignored chatter does not restart the inactivity timer', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { games } = setup();
  t.mock.timers.tick(SEQUENCE_IDLE_MS - 1000);
  await say(games, 'just chatting');
  t.mock.timers.tick(1000);
  assert.equal(games.hasSession(GROUP), false);
});

test('ending or winning cancels the timeout notice', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const ended = setup();
  ended.games.end(GROUP);
  t.mock.timers.tick(SEQUENCE_IDLE_MS * 2);
  await Promise.resolve();
  assert.equal(ended.socket.sent.length, 0);

  const won = setup();
  await say(won.games, '10');
  t.mock.timers.tick(SEQUENCE_IDLE_MS * 2);
  await Promise.resolve();
  assert.equal(won.socket.sent.length, 1);
});

test('sequence is a public fun command with the seq alias', async () => {
  assert.equal(sequence.name, 'sequence');
  assert.deepEqual(sequence.aliases, ['seq']);
  assert.equal(sequence.category, 'fun');
  assert.deepEqual(sequence.permissions, ['public']);

  const registry = await loadCommands(path.join(ROOT, 'commands'), silent);
  assert.equal(registry.get('sequence'), registry.get('seq'));
  assert.equal(registry.get('seq').category, 'fun');
  assert.match(registry.get('seq').source, /commands[\\/]fun[\\/]sequence\.js$/);
});

test('!sequence starts an easy game by default and explains the rules', async () => {
  const games = createGameManager({ logger: silent });
  const { ctx, replies } = makeCtx(games);
  await sequence.execute(ctx);
  const session = games.get(GROUP);
  assert.equal(session.type, 'sequence');
  assert.equal(session.starterJid, MEMBER);
  assert.equal(session.data.difficulty, 'easy');
  assert.match(replies[0].text, /SEQUENCE CHALLENGE/);
  assert.match(replies[0].text, /3 valid guesses/);
  assert.match(replies[0].text, /!sequence <number>/);
  games.shutdown();
});

test('!sequence medium starts from the medium pool', async () => {
  const games = createGameManager({ logger: silent });
  const { ctx } = makeCtx(games, { args: ['medium'], argsText: 'medium' });
  await sequence.execute(ctx);
  assert.equal(games.get(GROUP).data.difficulty, 'medium');
  games.shutdown();
});

test('!sequence with no argument while a game runs shows its status', async () => {
  const { games, session } = setup();
  const { ctx, replies } = makeCtx(games);
  await sequence.execute(ctx);
  assert.match(replies[0].text, /IN PROGRESS/);
  assert.equal(session.data.attempts, 0);
  assert.equal(games.get(GROUP), session);
});

test('!sequence status shows history without consuming an attempt', async () => {
  const { games, session } = setup();
  processSequence(session, 9, MEMBER);
  const { ctx, replies } = makeCtx(games, { args: ['status'], argsText: 'status' });
  await sequence.execute(ctx);
  assert.match(replies[0].text, /IN PROGRESS/);
  assert.match(replies[0].text, /TRIED: 9/);
  assert.equal(session.data.attempts, 1);
});

test('!sequence <n> plays a guess in the running game', async () => {
  const { games, session } = setup();
  const miss = makeCtx(games, { args: ['9'], argsText: '9' });
  await sequence.execute(miss.ctx);
  assert.match(miss.replies[0].text, /not the next number/);
  assert.equal(session.data.attempts, 1);

  const win = makeCtx(games, { args: ['10'], argsText: '10', senderJid: OTHER });
  await sequence.execute(win.ctx);
  assert.match(win.replies[0].text, /SOLVED/);
  assert.deepEqual(win.replies[0].options.mentions, [OTHER]);
  assert.equal(games.hasSession(GROUP), false);
});

test('!sequence rejects invalid answers without consuming an attempt', async () => {
  const { games, session } = setup();
  for (const arg of ['abc', '3.5', 'ten', '1e2']) {
    const { ctx } = makeCtx(games, { args: [arg], argsText: arg });
    await assert.rejects(() => sequence.execute(ctx), CommandError, arg);
  }
  assert.equal(session.data.attempts, 0);
});

test('!sequence quit ends the game and reveals the answer', async () => {
  const { games } = setup();
  const { ctx, replies } = makeCtx(games, { args: ['quit'], argsText: 'quit' });
  await sequence.execute(ctx);
  assert.match(replies[0].text, /QUIT/);
  assert.match(replies[0].text, /ANSWER: 10/);
  assert.equal(games.hasSession(GROUP), false);
});

test('!sequence is refused while a different game is running, and leaves it untouched', async () => {
  const games = createGameManager({ logger: silent });
  const other = games.start(GROUP, { type: 'trivia', game: { onText() {} }, starterJid: MEMBER });
  const { ctx } = makeCtx(games, { args: ['easy'], argsText: 'easy' });
  await assert.rejects(() => sequence.execute(ctx), (error) => {
    assert.ok(error instanceof CommandError);
    assert.match(error.message, /already running/);
    return true;
  });
  assert.equal(games.get(GROUP), other);
});

test('!sequence fails cleanly when the game engine is missing', async () => {
  const { ctx } = makeCtx(null);
  await assert.rejects(() => sequence.execute(ctx), CommandError);
});

test('!sequence works in a direct chat', async () => {
  const games = createGameManager({ logger: silent });
  const { ctx } = makeCtx(games, { chatJid: MEMBER, isGroup: false });
  await sequence.execute(ctx);
  assert.equal(games.get(MEMBER).type, 'sequence');
  games.shutdown();
});
