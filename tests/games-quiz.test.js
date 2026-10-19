import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createGameManager } from '../lib/games/manager.js';
import {
  QUIZ_KINDS,
  describeQuizStart,
  matchesAnswer,
  normalizeAnswer,
  processAnswer,
  startQuiz,
  validateQuestion,
} from '../lib/games/quiz.js';
import { startGuess } from '../lib/games/guess.js';
import { EMOJI_QUESTIONS, QUIZ_QUESTIONS, RIDDLES, TRIVIA_QUESTIONS } from '../lib/games/quiz-data.js';
import { loadCommands } from '../lib/registry.js';
import { createLogger } from '../lib/logger.js';
import { CommandError } from '../lib/helpers.js';
import trivia from '../commands/fun/trivia.js';
import riddle from '../commands/fun/riddle.js';
import quiz from '../commands/fun/quiz.js';
import emojiquiz from '../commands/fun/emojiquiz.js';

const ROOT = path.resolve(import.meta.dirname, '..');
const GROUP = '120363000000000000@g.us';
const MEMBER = '111@s.whatsapp.net';
const OTHER = '222@s.whatsapp.net';
const silent = createLogger({ level: 'silent' });

const TEXT_Q = { prompt: 'What is the capital of Nigeria?', answers: ['abuja'], display: 'Abuja' };
const CHOICE_Q = { prompt: 'What is 2 + 2?', options: ['3', '4', '5', '6'], correct: 1, display: '4' };

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

function setup(kind, { question, timeoutMs } = {}) {
  const socket = makeSocket();
  const games = createGameManager({ getSocket: () => socket, logger: silent });
  const session = startQuiz(games, GROUP, kind, {
    starterJid: MEMBER,
    question: question ?? (kind === 'quiz' ? CHOICE_Q : TEXT_Q),
    ...(timeoutMs ? { timeoutMs } : {}),
  });
  return { socket, games, session };
}

function say(games, text, { senderJid = MEMBER, isGroup = true, groupMeta = null, chatJid = GROUP } = {}) {
  return games.handleText({ chatJid, senderJid, text, isGroup, groupMeta });
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

// ── answer normalization and matching ───────────────────────────────────────

test('normalizeAnswer ignores case, accents, punctuation, spacing and a leading article', () => {
  const table = [
    [' Spider-Man ', 'spiderman'],
    ['SPIDERMAN', 'spiderman'],
    ['The Nile', 'nile'],
    ['an echo', 'echo'],
    ['Café', 'cafe'],
    ['H2O!', 'h2o'],
    ['the', 'the'], // a lone article is kept
    ['a', 'a'],
    [8, '8'],
    ['🦁👑', ''],
    ['   ', ''],
    [null, ''],
    [undefined, ''],
    [{}, ''],
  ];
  for (const [input, expected] of table) assert.equal(normalizeAnswer(input), expected, String(input));
});

test('matchesAnswer is an exact match after normalization, never a substring match', () => {
  assert.equal(matchesAnswer('abuja', ['abuja']), true);
  assert.equal(matchesAnswer('  ABUJA. ', ['abuja']), true);
  assert.equal(matchesAnswer('the lion king', ['lion king']), true);
  assert.equal(matchesAnswer('spider man', ['spiderman']), true);
  assert.equal(matchesAnswer('i think it is abuja', ['abuja']), false);
  assert.equal(matchesAnswer('abujaa', ['abuja']), false);
  assert.equal(matchesAnswer('', ['abuja']), false);
  assert.equal(matchesAnswer('🦁', ['abuja']), false);
  assert.equal(matchesAnswer('abuja', 'abuja'), false);
  assert.equal(matchesAnswer('abuja', undefined), false);
});

// ── question banks and validation ───────────────────────────────────────────

test('every bundled question is well-formed, and its display answer is accepted', () => {
  for (const [name, kind] of Object.entries(QUIZ_KINDS)) {
    assert.ok(kind.bank.length >= 5, `${name} bank is too small`);
    assert.ok(kind.timeoutMs > 0, `${name} timeout`);
    const prompts = new Set();
    for (const question of kind.bank) {
      assert.doesNotThrow(() => validateQuestion(question, kind.mode), `${name}: ${question.prompt}`);
      assert.equal(prompts.has(question.prompt), false, `${name}: duplicate prompt ${question.prompt}`);
      prompts.add(question.prompt);
      if (kind.mode === 'text') {
        assert.equal(matchesAnswer(question.display, question.answers), true, `${name}: ${question.display}`);
      } else {
        assert.equal(new Set(question.options).size, question.options.length, `${name}: duplicate options`);
        assert.equal(question.options[question.correct], question.display, `${name}: display vs correct`);
      }
    }
  }
  assert.equal(QUIZ_KINDS.trivia.bank, TRIVIA_QUESTIONS);
  assert.equal(QUIZ_KINDS.riddle.bank, RIDDLES);
  assert.equal(QUIZ_KINDS.quiz.bank, QUIZ_QUESTIONS);
  assert.equal(QUIZ_KINDS.emojiquiz.bank, EMOJI_QUESTIONS);
});

test('quiz kinds use the reference timeouts and modes', () => {
  assert.deepEqual(
    Object.fromEntries(Object.entries(QUIZ_KINDS).map(([name, kind]) => [name, [kind.mode, kind.timeoutMs]])),
    { trivia: ['text', 30_000], riddle: ['text', 60_000], quiz: ['choice', 30_000], emojiquiz: ['text', 45_000] },
  );
});

test('validateQuestion rejects malformed questions', () => {
  const bad = [
    [null, 'text'],
    [{ display: 'x', answers: ['x'] }, 'text'],
    [{ prompt: 'p', answers: ['x'] }, 'text'],
    [{ prompt: 'p', display: 'x', answers: [] }, 'text'],
    [{ prompt: 'p', display: 'x', answers: ['🦁'] }, 'text'],
    [{ prompt: 'p', display: 'x', options: ['a'], correct: 0 }, 'choice'],
    [{ prompt: 'p', display: 'x', options: ['a', 'b'], correct: 2 }, 'choice'],
    [{ prompt: 'p', display: 'x', options: ['a', 'b'], correct: -1 }, 'choice'],
    [{ prompt: 'p', display: 'x', options: ['a', ''], correct: 0 }, 'choice'],
    [{ prompt: 'p', display: 'x', options: ['a', 'b'] }, 'choice'],
  ];
  for (const [question, mode] of bad) {
    assert.throws(() => validateQuestion(question, mode), TypeError, JSON.stringify(question));
  }
});

// ── starting rounds ─────────────────────────────────────────────────────────

test('startQuiz registers a session of the right type with the starter and deadline', () => {
  for (const kind of Object.keys(QUIZ_KINDS)) {
    const { games, session } = setup(kind);
    assert.equal(session.type, kind);
    assert.equal(session.starterJid, MEMBER);
    assert.equal(session.data.timeoutMs, QUIZ_KINDS[kind].timeoutMs);
    assert.equal(games.get(GROUP), session);
    games.shutdown();
  }
});

test('startQuiz rejects unknown kinds and invalid questions without creating a session', () => {
  const games = createGameManager({ logger: silent });
  for (const kind of ['nope', 'constructor', '__proto__', undefined]) {
    assert.throws(() => startQuiz(games, GROUP, kind), TypeError, String(kind));
  }
  assert.throws(() => startQuiz(games, GROUP, 'trivia', { question: { prompt: 'p' } }), TypeError);
  for (const timeoutMs of [Number.NaN, -1, Infinity, -Infinity, '1000']) {
    assert.throws(
      () => startQuiz(games, GROUP, 'trivia', { question: TEXT_Q, timeoutMs }),
      TypeError,
      String(timeoutMs),
    );
    assert.equal(games.hasSession(GROUP), false, `session left behind for timeoutMs=${String(timeoutMs)}`);
  }
  assert.equal(games.hasSession(GROUP), false);
});

test('startQuiz is rejected while any other game is running, leaving it untouched', () => {
  const { games, session } = setup('trivia');
  assert.throws(() => startQuiz(games, GROUP, 'riddle'), (error) => {
    assert.ok(error instanceof CommandError);
    assert.match(error.message, /already running/);
    return true;
  });
  assert.equal(games.get(GROUP), session);

  const other = createGameManager({ logger: silent });
  const guessSession = startGuess(other, GROUP, { starterJid: MEMBER });
  assert.throws(() => startQuiz(other, GROUP, 'quiz'), CommandError);
  assert.equal(other.get(GROUP), guessSession);
});

test('startQuiz picks from the bank using the supplied random source', () => {
  const games = createGameManager({ logger: silent });
  const first = startQuiz(games, GROUP, 'trivia', { random: () => 0 });
  assert.equal(first.data.question, TRIVIA_QUESTIONS[0]);
  games.shutdown();
  const last = startQuiz(games, GROUP, 'trivia', { random: () => 0.999999 });
  assert.equal(last.data.question, TRIVIA_QUESTIONS.at(-1));
  games.shutdown();
});

test('describeQuizStart shows the prompt, timeout, hint and options without the answer', () => {
  const trivialText = describeQuizStart(setup('trivia').session);
  assert.match(trivialText, /TRIVIA/);
  assert.match(trivialText, /capital of Nigeria/);
  assert.match(trivialText, /30 seconds/);
  assert.doesNotMatch(trivialText, /Abuja/);

  const emoji = setup('emojiquiz', { question: { prompt: '🦁👑', answers: ['lion king'], display: 'The Lion King', hint: 'Disney' } });
  const emojiText = describeQuizStart(emoji.session);
  assert.match(emojiText, /🦁👑/);
  assert.match(emojiText, /HINT: Disney/);
  assert.match(emojiText, /45 seconds/);
  assert.doesNotMatch(emojiText, /Lion King/);

  const choice = describeQuizStart(setup('quiz').session);
  assert.match(choice, /1\. 3/);
  assert.match(choice, /4\. 6/);
  assert.match(choice, /1-4/);
});

// ── free-text answers (trivia, riddle, emojiquiz) ───────────────────────────

test('wrong answers and chatter are ignored silently and change nothing', async () => {
  for (const kind of ['trivia', 'riddle', 'emojiquiz']) {
    const { games, socket, session } = setup(kind);
    for (const text of ['hello everyone', 'lagos', '42', 'i think it is abuja', '🦁', '   ', 'abujaa']) {
      assert.equal(await say(games, text), true); // routed to the session, ignored by it
    }
    assert.equal(socket.sent.length, 0, kind);
    assert.equal(games.get(GROUP), session);
    games.shutdown();
  }
});

test('a correct answer wins, mentions the player, reveals the answer and ends the round', async () => {
  const { games, socket } = setup('trivia');
  await say(games, 'lagos');
  await say(games, 'Abuja', { senderJid: OTHER });
  assert.equal(socket.sent.length, 1);
  const win = socket.sent[0];
  assert.equal(win.jid, GROUP);
  assert.match(win.content.text, /CORRECT/);
  assert.match(win.content.text, /@222 got it/);
  assert.match(win.content.text, /ANSWER: Abuja/);
  assert.deepEqual(win.content.mentions, [OTHER]);
  assert.equal(games.hasSession(GROUP), false);
  assert.equal(await say(games, 'abuja'), false);
});

test('answers are accepted regardless of case, punctuation, spacing or a leading article', async () => {
  for (const text of ['ABUJA', '  abuja.  ', 'The Abuja', 'Abuja!!']) {
    const { games, socket } = setup('riddle');
    await say(games, text);
    assert.equal(socket.sent.length, 1, text);
    assert.match(socket.sent[0].content.text, /CORRECT/, text);
  }
});

test('any listed alias is accepted', async () => {
  const question = { prompt: 'How many planets?', answers: ['8', 'eight'], display: '8' };
  for (const text of ['8', 'Eight']) {
    const { games, socket } = setup('trivia', { question });
    await say(games, text);
    assert.match(socket.sent[0].content.text, /CORRECT/, text);
  }
});

test('over-long messages are ignored even when they contain the answer', () => {
  const { session } = setup('trivia');
  assert.equal(processAnswer(session, `abuja${' '.repeat(200)}`, { senderJid: MEMBER }), null);
  assert.equal(session.ended, false);
});

test('two simultaneous correct answers produce exactly one win', async () => {
  const { games, socket } = setup('trivia');
  await Promise.all([say(games, 'abuja', { senderJid: MEMBER }), say(games, 'abuja', { senderJid: OTHER })]);
  assert.equal(socket.sent.length, 1);
  assert.match(socket.sent[0].content.text, /CORRECT/);
});

test('processAnswer is a no-op for missing, ended or foreign sessions', () => {
  const { games, session } = setup('trivia');
  games.end(GROUP);
  assert.equal(processAnswer(session, 'abuja', { senderJid: MEMBER }), null);
  assert.equal(processAnswer(null, 'abuja'), null);
  assert.equal(processAnswer({ type: 'guess', ended: false, data: {} }, 'abuja'), null);
  assert.equal(processAnswer({ type: 'constructor', ended: false, data: {} }, 'abuja'), null);
});

// ── multiple choice (quiz) ──────────────────────────────────────────────────

test('quiz ignores out-of-range numbers and non-numeric chatter without locking anyone', async () => {
  const { games, socket, session } = setup('quiz');
  for (const text of ['0', '5', '9', '10', '99', 'hello', '2 3', 'b', '2.5', '-1', '🦁']) {
    await say(games, text);
  }
  assert.equal(socket.sent.length, 0);
  assert.equal(session.data.locked.size, 0);
  assert.equal(games.get(GROUP), session);
});

test('quiz: the correct option number wins and ends the round', async () => {
  const { games, socket } = setup('quiz');
  await say(games, ' 2 ', { senderJid: OTHER });
  assert.match(socket.sent[0].content.text, /CORRECT/);
  assert.match(socket.sent[0].content.text, /ANSWER: 4/);
  assert.deepEqual(socket.sent[0].content.mentions, [OTHER]);
  assert.equal(games.hasSession(GROUP), false);
});

test('quiz in a group: a wrong option locks only that player out; others can still win', async () => {
  const { games, socket, session } = setup('quiz');
  await say(games, '3', { senderJid: MEMBER });
  assert.match(socket.sent[0].content.text, /WRONG/);
  assert.match(socket.sent[0].content.text, /@111/);
  assert.deepEqual(socket.sent[0].content.mentions, [MEMBER]);
  assert.equal(games.get(GROUP), session);

  // The locked player gets no second try, not even with the right option.
  await say(games, '2', { senderJid: MEMBER });
  await say(games, '1', { senderJid: MEMBER });
  assert.equal(socket.sent.length, 1);
  assert.equal(games.get(GROUP), session);

  await say(games, '2', { senderJid: OTHER });
  assert.equal(socket.sent.length, 2);
  assert.match(socket.sent[1].content.text, /CORRECT/);
  assert.equal(games.hasSession(GROUP), false);
});

test('quiz lock-out recognises one player across LID and phone forms', async () => {
  const groupMeta = { participants: [{ id: '5@lid', phoneNumber: '2348012345678@s.whatsapp.net' }, { id: OTHER }] };
  const { games, socket, session } = setup('quiz');
  await say(games, '3', { senderJid: '5@lid', groupMeta });
  await say(games, '2', { senderJid: '2348012345678@s.whatsapp.net', groupMeta });
  assert.equal(socket.sent.length, 1);
  assert.equal(games.get(GROUP), session);
});

test('quiz in a direct chat: a wrong option ends the round and reveals the answer', async () => {
  const socket = makeSocket();
  const games = createGameManager({ getSocket: () => socket, logger: silent });
  startQuiz(games, MEMBER, 'quiz', { starterJid: MEMBER, question: CHOICE_Q });
  await say(games, '4', { chatJid: MEMBER, isGroup: false });
  assert.match(socket.sent[0].content.text, /WRONG ANSWER/);
  assert.match(socket.sent[0].content.text, /ANSWER: 4/);
  assert.equal(games.hasSession(MEMBER), false);
});

test('quiz: two simultaneous correct answers produce exactly one win', async () => {
  const { games, socket } = setup('quiz');
  await Promise.all([say(games, '2', { senderJid: MEMBER }), say(games, '2', { senderJid: OTHER })]);
  assert.equal(socket.sent.length, 1);
});

// ── timeouts and cleanup ────────────────────────────────────────────────────

test('each kind times out at its own deadline, revealing the answer and freeing the chat', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  for (const [kind, config] of Object.entries(QUIZ_KINDS)) {
    const { games, socket } = setup(kind);
    t.mock.timers.tick(config.timeoutMs - 1);
    assert.equal(games.hasSession(GROUP), true, `${kind} too early`);
    t.mock.timers.tick(1);
    await Promise.resolve();
    assert.equal(games.hasSession(GROUP), false, `${kind} not cleaned up`);
    assert.equal(socket.sent.length, 1, kind);
    assert.match(socket.sent[0].content.text, /TIME'S UP/);
    assert.match(socket.sent[0].content.text, kind === 'quiz' ? /ANSWER: 4/ : /ANSWER: Abuja/);
  }
});

test('chatter, wrong answers and lock-outs never extend the deadline', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { games } = setup('trivia', { timeoutMs: 10_000 });
  t.mock.timers.tick(9_000);
  await say(games, 'just chatting');
  await say(games, 'lagos');
  t.mock.timers.tick(1_000);
  assert.equal(games.hasSession(GROUP), false);

  const choice = setup('quiz', { timeoutMs: 10_000 });
  t.mock.timers.tick(9_000);
  await say(choice.games, '3');
  t.mock.timers.tick(1_000);
  assert.equal(choice.games.hasSession(GROUP), false);
});

test('winning or ending the round clears the session timers and cancels the timeout notice', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const won = setup('trivia');
  assert.equal(won.session.timers.size, 1);
  await say(won.games, 'abuja');
  assert.equal(won.session.ended, true);
  assert.equal(won.session.timers.size, 0);
  t.mock.timers.tick(QUIZ_KINDS.trivia.timeoutMs * 2);
  await Promise.resolve();
  assert.equal(won.socket.sent.length, 1);

  const ended = setup('riddle');
  assert.equal(ended.session.timers.size, 1);
  ended.games.end(GROUP);
  assert.equal(ended.session.ended, true);
  assert.equal(ended.session.timers.size, 0);
  t.mock.timers.tick(QUIZ_KINDS.riddle.timeoutMs * 2);
  await Promise.resolve();
  assert.equal(ended.socket.sent.length, 0);
});

test('a surviving timer from a replaced session is blocked by the stale-session guard', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const socket = makeSocket();
  const games = createGameManager({ getSocket: () => socket, logger: silent });
  const first = startQuiz(games, GROUP, 'trivia', { question: TEXT_Q, timeoutMs: 1_000 });
  // As in the Stage 2 stale-id test: drop the chat's session WITHOUT end(), so
  // the first round is not marked ended and its timer is never cleared.
  games.sessions.delete(GROUP);
  const second = startQuiz(games, GROUP, 'riddle', { question: TEXT_Q, timeoutMs: 5_000 });
  assert.equal(first.ended, false);
  assert.equal(first.timers.size, 1);
  assert.notEqual(first.id, second.id);

  t.mock.timers.tick(1_000); // the first round's deadline arrives while the second round owns the chat
  await Promise.resolve();
  assert.equal(first.ended, false); // its callback returned early: it never ran api.end()
  assert.equal(second.ended, false);
  assert.equal(games.get(GROUP), second);
  assert.equal(socket.sent.length, 0); // no "TIME'S UP" notice from the stale round

  t.mock.timers.tick(4_000); // the second round's own deadline still works
  await Promise.resolve();
  assert.equal(games.hasSession(GROUP), false);
  assert.equal(socket.sent.length, 1);
  assert.match(socket.sent[0].content.text, /TIME'S UP/);
});

test('shutdown clears every quiz timer', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { games, socket, session } = setup('emojiquiz');
  assert.equal(session.timers.size, 1);
  games.shutdown();
  assert.equal(session.ended, true);
  assert.equal(session.timers.size, 0);
  assert.equal(games.hasSession(GROUP), false);
  t.mock.timers.tick(QUIZ_KINDS.emojiquiz.timeoutMs * 2);
  await Promise.resolve();
  assert.equal(socket.sent.length, 0);
});

// ── commands ────────────────────────────────────────────────────────────────

const COMMANDS = { trivia, riddle, quiz, emojiquiz };

test('the four quiz commands are public fun commands with no aliases', () => {
  for (const [name, command] of Object.entries(COMMANDS)) {
    assert.equal(command.name, name);
    assert.equal(command.category, 'fun');
    assert.deepEqual(command.permissions, ['public']);
    assert.deepEqual(command.aliases, []);
    assert.equal(command.usage, name);
    assert.ok(command.description.length >= 3);
    assert.ok(command.cooldownMs > 0);
  }
});

test('each command starts its own game type and announces the question without the answer', async (t) => {
  t.mock.method(Math, 'random', () => 0); // pick() -> first question in each bank
  for (const [name, command] of Object.entries(COMMANDS)) {
    const games = createGameManager({ logger: silent });
    const { ctx, replies } = makeCtx(games);
    await command.execute(ctx);
    const session = games.get(GROUP);
    assert.equal(session.type, name);
    assert.equal(session.starterJid, MEMBER);
    assert.equal(replies.length, 1);
    const first = QUIZ_KINDS[name].bank[0];
    assert.ok(replies[0].text.includes(first.prompt), name);
    if (QUIZ_KINDS[name].mode === 'text') {
      assert.ok(!replies[0].text.includes(first.display), `${name} leaked its answer`);
    } else {
      assert.match(replies[0].text, /1\. London/);
      assert.match(replies[0].text, /\(1-4\)/);
    }
    if (name === 'emojiquiz') assert.ok(replies[0].text.includes(first.hint));
    games.shutdown();
  }
});

test('a command is refused while any game is running in the chat', async () => {
  const games = createGameManager({ logger: silent });
  const running = games.start(GROUP, { type: 'tictactoe', game: { onText() {} }, starterJid: MEMBER });
  for (const command of Object.values(COMMANDS)) {
    const { ctx, replies } = makeCtx(games);
    await assert.rejects(() => command.execute(ctx), (error) => {
      assert.ok(error instanceof CommandError);
      assert.match(error.message, /already running/);
      return true;
    });
    assert.equal(replies.length, 0);
    assert.equal(games.get(GROUP), running);
  }
});

test('commands fail cleanly when the game engine is missing', async () => {
  for (const command of Object.values(COMMANDS)) {
    const { ctx } = makeCtx(null);
    await assert.rejects(() => command.execute(ctx), CommandError);
  }
});

test('commands work in a direct chat', async () => {
  const games = createGameManager({ logger: silent });
  const { ctx } = makeCtx(games, { chatJid: MEMBER, isGroup: false });
  await trivia.execute(ctx);
  assert.equal(games.get(MEMBER).type, 'trivia');
  games.shutdown();
});

// ── registry ────────────────────────────────────────────────────────────────

test('registry loads the four quiz commands alongside Stage 2 and 3 commands without conflicts', async () => {
  const registry = await loadCommands(path.join(ROOT, 'commands'), silent);
  for (const name of ['trivia', 'riddle', 'quiz', 'emojiquiz', 'endgame', 'guess', 'rps']) {
    const command = registry.get(name);
    assert.ok(command, `missing command: ${name}`);
    assert.equal(command.category, 'fun');
  }
  assert.match(registry.get('quiz').source, /commands[\\/]fun[\\/]quiz\.js$/);
});