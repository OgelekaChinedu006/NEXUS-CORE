import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createGameManager } from '../lib/games/manager.js';
import {
  MARK_ABSENT,
  MARK_CORRECT,
  MARK_PRESENT,
  WORD_DEDUCTION_IDLE_MS,
  WORD_DEDUCTION_MAX_ATTEMPTS,
  WORD_DEDUCTION_WORD_LENGTH,
  WORD_DEDUCTION_WORDS,
  describeWordDeductionStart,
  describeWordDeductionStatus,
  formatMarks,
  isFiveLetterWord,
  isQuitCommand,
  isStatusCommand,
  parseWordDeduction,
  processWordDeduction,
  quitWordDeduction,
  scoreGuess,
  startWordDeduction,
  wordDeductionGame,
} from '../lib/games/worddeduction.js';
import { loadCommands } from '../lib/registry.js';
import { createLogger } from '../lib/logger.js';
import { CommandError } from '../lib/helpers.js';
import worddeduction from '../commands/fun/worddeduction.js';

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

function setup({ answer = 'crane', idleMs, maxAttempts } = {}) {
  const socket = makeSocket();
  const games = createGameManager({ getSocket: () => socket, logger: silent });
  const session = startWordDeduction(games, GROUP, {
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

test('parseWordDeduction accepts only a bare five-letter word', () => {
  assert.equal(parseWordDeduction('crane'), 'crane');
  assert.equal(parseWordDeduction('  Apple '), 'apple');
  assert.equal(parseWordDeduction('CRANE'), 'crane');
  for (const text of [
    'cat', 'cranes', 'cran!', 'two words', 'cra4e', '', '   ', '12345', null, undefined, 5,
  ]) {
    assert.equal(parseWordDeduction(text), null, String(text));
  }
});

test('isFiveLetterWord and command helpers', () => {
  assert.equal(isFiveLetterWord('crane'), true);
  assert.equal(isFiveLetterWord('CRANE'), true);
  assert.equal(isFiveLetterWord(' crane '), true);
  assert.equal(isFiveLetterWord('cat'), false);
  assert.equal(isFiveLetterWord('cra4e'), false);
  assert.equal(isQuitCommand('quit'), true);
  assert.equal(isQuitCommand(' STOP '), true);
  assert.equal(isQuitCommand('end'), true);
  assert.equal(isQuitCommand('crane'), false);
  assert.equal(isStatusCommand('status'), true);
  assert.equal(isStatusCommand(' STATUS '), true);
  assert.equal(isStatusCommand('quit'), false);
});

test('the built-in word list contains only unique five-letter words', () => {
  assert.ok(WORD_DEDUCTION_WORDS.length > 50);
  const seen = new Set();
  for (const word of WORD_DEDUCTION_WORDS) {
    assert.equal(isFiveLetterWord(word), true, word);
    assert.equal(seen.has(word), false, word);
    seen.add(word);
  }
});

test('scoreGuess awards greens first then yellows for remaining unmatched letters', () => {
  assert.deepEqual(scoreGuess('crane', 'crane'), [
    MARK_CORRECT, MARK_CORRECT, MARK_CORRECT, MARK_CORRECT, MARK_CORRECT,
  ]);
  assert.deepEqual(scoreGuess('crane', 'zzzzz'), [
    MARK_ABSENT, MARK_ABSENT, MARK_ABSENT, MARK_ABSENT, MARK_ABSENT,
  ]);
  assert.deepEqual(scoreGuess('crane', 'nacre'), [
    MARK_PRESENT, MARK_PRESENT, MARK_PRESENT, MARK_PRESENT, MARK_CORRECT,
  ]);
  assert.equal(scoreGuess('cat', 'crane'), null);
  assert.equal(scoreGuess('crane', 'no'), null);
});

test('scoreGuess handles repeated letters without over-marking', () => {
  assert.deepEqual(scoreGuess('abbey', 'bubba'), [
    MARK_PRESENT, MARK_ABSENT, MARK_CORRECT, MARK_ABSENT, MARK_PRESENT,
  ]);
  assert.deepEqual(scoreGuess('eerie', 'speed'), [
    MARK_ABSENT, MARK_ABSENT, MARK_PRESENT, MARK_PRESENT, MARK_ABSENT,
  ]);
  assert.deepEqual(scoreGuess('llama', 'alarm'), [
    MARK_PRESENT, MARK_CORRECT, MARK_CORRECT, MARK_ABSENT, MARK_PRESENT,
  ]);
  assert.deepEqual(scoreGuess('allay', 'llama'), [
    MARK_PRESENT, MARK_CORRECT, MARK_PRESENT, MARK_ABSENT, MARK_PRESENT,
  ]);
  assert.deepEqual(scoreGuess('paper', 'apple'), [
    MARK_PRESENT, MARK_PRESENT, MARK_CORRECT, MARK_ABSENT, MARK_PRESENT,
  ]);
  assert.deepEqual(scoreGuess('sassy', 'assay'), [
    MARK_PRESENT, MARK_PRESENT, MARK_CORRECT, MARK_ABSENT, MARK_CORRECT,
  ]);
});

test('formatMarks renders the three tiles in order', () => {
  assert.equal(
    formatMarks([MARK_CORRECT, MARK_PRESENT, MARK_ABSENT, MARK_PRESENT, MARK_CORRECT]),
    '🟩🟨⬛🟨🟩',
  );
});

test('startWordDeduction registers a session with the chosen answer and starter', () => {
  const { games, session } = setup();
  assert.equal(session.type, 'worddeduction');
  assert.equal(session.data.answer, 'crane');
  assert.equal(session.data.attempts, 0);
  assert.equal(session.data.maxAttempts, WORD_DEDUCTION_MAX_ATTEMPTS);
  assert.equal(session.data.wordLength, WORD_DEDUCTION_WORD_LENGTH);
  assert.equal(session.starterJid, MEMBER);
  assert.equal(games.get(GROUP), session);
  assert.equal(session.timers.has('idle'), true);
  games.shutdown();
});

test('startWordDeduction refuses to start while any game is running in the chat', () => {
  const { games } = setup();
  assert.throws(() => startWordDeduction(games, GROUP, { starterJid: OTHER, answer: 'apple' }), CommandError);
  games.shutdown();
});

test('startWordDeduction rejects invalid answers, timeouts and attempt counts before registering', () => {
  const games = createGameManager({ logger: silent });
  assert.throws(() => startWordDeduction(games, GROUP, { answer: 'no' }), TypeError);
  assert.equal(games.hasSession(GROUP), false);
  for (const idleMs of [Number.NaN, -1, Infinity, '1000']) {
    assert.throws(() => startWordDeduction(games, GROUP, { answer: 'crane', idleMs }), TypeError, String(idleMs));
    assert.equal(games.hasSession(GROUP), false);
  }
  assert.throws(() => startWordDeduction(games, GROUP, { answer: 'crane', maxAttempts: 0 }), TypeError);
  assert.equal(games.hasSession(GROUP), false);
  games.shutdown();
});

test('start and status messages explain the rules and remaining attempts', () => {
  const { session } = setup();
  const start = describeWordDeductionStart(session, '!');
  assert.match(start, /WORD DEDUCTION/);
  assert.match(start, /5-letter/);
  assert.match(start, /6 valid guesses/);
  assert.match(start, /!worddeduction/);

  processWordDeduction(session, 'apple', MEMBER);
  const status = describeWordDeductionStatus(session);
  assert.match(status, /IN PROGRESS/);
  assert.match(status, /APPLE/);
  assert.match(status, /1\/6/);
});

test('plain chat and invalid tokens are ignored and cost no attempt', async () => {
  const { games, socket, session } = setup();
  for (const text of ['hello everyone', 'cat', 'cranes', 'cran!', '12345', 'cra4e']) {
    assert.equal(await say(games, text), true);
  }
  assert.equal(socket.sent.length, 0);
  assert.equal(session.data.attempts, 0);
});

test('a miss shows tiles, counts an attempt and keeps the session', async () => {
  const { games, socket, session } = setup();
  await say(games, 'apple');
  assert.match(socket.sent[0].content.text, /APPLE/);
  assert.match(socket.sent[0].content.text, /1\/6/);
  assert.equal(session.data.attempts, 1);
  assert.equal(session.data.guesses[0].word, 'apple');
  assert.equal(games.get(GROUP), session);
});

test('a repeated guess is reported and does not consume an attempt', async () => {
  const { games, socket, session } = setup();
  await say(games, 'apple');
  await say(games, 'APPLE');
  assert.match(socket.sent[1].content.text, /ALREADY TRIED/);
  assert.equal(session.data.attempts, 1);
});

test('a correct guess wins, mentions the winner and ends the session', async () => {
  const { games, socket } = setup();
  await say(games, 'apple');
  await say(games, 'crane', { senderJid: OTHER });
  const win = socket.sent[1];
  assert.match(win.content.text, /SOLVED/);
  assert.match(win.content.text, /CRANE/);
  assert.match(win.content.text, /2\/6/);
  assert.deepEqual(win.content.mentions, [OTHER]);
  assert.equal(games.hasSession(GROUP), false);
  assert.equal(await say(games, 'crane'), false);
});

test('using every attempt without finding the word ends the game and reveals it', async () => {
  const { games, socket } = setup();
  for (const word of ['apple', 'table', 'house', 'world', 'plant', 'sight']) {
    await say(games, word);
  }
  assert.equal(socket.sent.length, 6);
  assert.match(socket.sent[5].content.text, /FAILED/);
  assert.match(socket.sent[5].content.text, /CRANE/);
  assert.equal(games.hasSession(GROUP), false);
});

test('a guess on the last attempt can still win', async () => {
  const { games, socket } = setup();
  for (const word of ['apple', 'table', 'house', 'world', 'plant']) {
    await say(games, word);
  }
  await say(games, 'crane');
  assert.match(socket.sent[5].content.text, /SOLVED/);
  assert.match(socket.sent[5].content.text, /6\/6/);
});

test('two simultaneous winning guesses produce exactly one win', async () => {
  const { games, socket } = setup();
  await Promise.all([
    say(games, 'crane', { senderJid: MEMBER }),
    say(games, 'crane', { senderJid: OTHER }),
  ]);
  assert.equal(socket.sent.length, 1);
  assert.match(socket.sent[0].content.text, /SOLVED/);
});

test('processWordDeduction is a no-op for ended or foreign sessions', () => {
  const { games, session } = setup();
  games.end(GROUP);
  assert.equal(processWordDeduction(session, 'apple', MEMBER), null);
  assert.equal(processWordDeduction(null, 'apple', MEMBER), null);
  assert.equal(processWordDeduction({ type: 'guess', ended: false, data: {} }, 'apple', MEMBER), null);
});

test('wordDeductionGame ignores non-word input directly', async () => {
  const { session, socket } = setup();
  await wordDeductionGame.onText(session, { text: 'hi', senderJid: MEMBER }, session.api);
  await wordDeductionGame.onText(session, undefined, session.api);
  assert.equal(socket.sent.length, 0);
});

test('a game in one chat never accepts words from another chat', async () => {
  const { games, session } = setup();
  assert.equal(await say(games, 'apple', { chatJid: OTHER_GROUP }), false);
  assert.equal(session.data.attempts, 0);
  assert.equal(games.get(GROUP), session);
});

test('quitWordDeduction ends the session and reveals the answer', () => {
  const { games, session } = setup();
  const outcome = quitWordDeduction(session, MEMBER);
  assert.equal(outcome.kind, 'quit');
  assert.match(outcome.text, /QUIT/);
  assert.match(outcome.text, /CRANE/);
  assert.deepEqual(outcome.mentions, [MEMBER]);
  assert.equal(games.hasSession(GROUP), false);
  assert.equal(quitWordDeduction(session, MEMBER), null);
});

test('an idle game times out, reveals the word and frees the chat', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { games, socket } = setup();
  t.mock.timers.tick(WORD_DEDUCTION_IDLE_MS - 1);
  assert.equal(games.hasSession(GROUP), true);
  t.mock.timers.tick(1);
  await Promise.resolve();
  assert.equal(games.hasSession(GROUP), false);
  assert.equal(socket.sent.length, 1);
  assert.match(socket.sent[0].content.text, /TIMED OUT/);
  assert.match(socket.sent[0].content.text, /CRANE/);
});

test('each valid guess restarts the inactivity timer', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { games, socket } = setup();
  t.mock.timers.tick(WORD_DEDUCTION_IDLE_MS - 1000);
  await say(games, 'apple');
  t.mock.timers.tick(WORD_DEDUCTION_IDLE_MS - 1000);
  assert.equal(games.hasSession(GROUP), true);
  t.mock.timers.tick(1000);
  await Promise.resolve();
  assert.equal(games.hasSession(GROUP), false);
  assert.match(socket.sent.at(-1).content.text, /TIMED OUT/);
});

test('ignored chatter does not restart the inactivity timer', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { games } = setup();
  t.mock.timers.tick(WORD_DEDUCTION_IDLE_MS - 1000);
  await say(games, 'just chatting');
  t.mock.timers.tick(1000);
  assert.equal(games.hasSession(GROUP), false);
});

test('ending or winning cancels the timeout notice', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const ended = setup();
  ended.games.end(GROUP);
  t.mock.timers.tick(WORD_DEDUCTION_IDLE_MS * 2);
  await Promise.resolve();
  assert.equal(ended.socket.sent.length, 0);

  const won = setup();
  await say(won.games, 'crane');
  t.mock.timers.tick(WORD_DEDUCTION_IDLE_MS * 2);
  await Promise.resolve();
  assert.equal(won.socket.sent.length, 1);
});

test('worddeduction is a public fun command with the wd alias', async () => {
  assert.equal(worddeduction.name, 'worddeduction');
  assert.deepEqual(worddeduction.aliases, ['wd']);
  assert.equal(worddeduction.category, 'fun');
  assert.deepEqual(worddeduction.permissions, ['public']);

  const registry = await loadCommands(path.join(ROOT, 'commands'), silent);
  assert.equal(registry.get('worddeduction'), registry.get('wd'));
  assert.equal(registry.get('wd').category, 'fun');
  assert.match(registry.get('wd').source, /commands[\\/]fun[\\/]worddeduction\.js$/);
});

test('!worddeduction starts a game, records the starter and explains the rules', async () => {
  const games = createGameManager({ logger: silent });
  const { ctx, replies } = makeCtx(games);
  await worddeduction.execute(ctx);
  const session = games.get(GROUP);
  assert.equal(session.type, 'worddeduction');
  assert.equal(session.starterJid, MEMBER);
  assert.equal(isFiveLetterWord(session.data.answer), true);
  assert.match(replies[0].text, /WORD DEDUCTION/);
  assert.match(replies[0].text, /5-letter/);
  assert.match(replies[0].text, /6 valid guesses/);
  assert.match(replies[0].text, /!worddeduction <word>/);
  games.shutdown();
});

test('!worddeduction with no argument while a game runs shows its status', async () => {
  const { games, session } = setup();
  const { ctx, replies } = makeCtx(games);
  await worddeduction.execute(ctx);
  assert.match(replies[0].text, /IN PROGRESS/);
  assert.equal(session.data.attempts, 0);
  assert.equal(games.get(GROUP), session);
});

test('!worddeduction status shows history without consuming an attempt', async () => {
  const { games, session } = setup();
  processWordDeduction(session, 'apple', MEMBER);
  const { ctx, replies } = makeCtx(games, { args: ['status'], argsText: 'status' });
  await worddeduction.execute(ctx);
  assert.match(replies[0].text, /IN PROGRESS/);
  assert.match(replies[0].text, /APPLE/);
  assert.equal(session.data.attempts, 1);
});

test('!worddeduction <word> plays a guess in the running game', async () => {
  const { games, session } = setup();
  const miss = makeCtx(games, { args: ['apple'], argsText: 'apple' });
  await worddeduction.execute(miss.ctx);
  assert.match(miss.replies[0].text, /APPLE/);
  assert.equal(session.data.attempts, 1);

  const win = makeCtx(games, { args: ['crane'], argsText: 'crane', senderJid: OTHER });
  await worddeduction.execute(win.ctx);
  assert.match(win.replies[0].text, /SOLVED/);
  assert.deepEqual(win.replies[0].options.mentions, [OTHER]);
  assert.equal(games.hasSession(GROUP), false);
});

test('!worddeduction rejects invalid words without consuming an attempt', async () => {
  const { games, session } = setup();
  for (const arg of ['abc', 'cranes', 'cran!', '12345', 'cra4e']) {
    const { ctx } = makeCtx(games, { args: [arg], argsText: arg });
    await assert.rejects(() => worddeduction.execute(ctx), CommandError, arg);
  }
  assert.equal(session.data.attempts, 0);
});

test('!worddeduction quit ends the game and reveals the answer', async () => {
  const { games } = setup();
  const { ctx, replies } = makeCtx(games, { args: ['quit'], argsText: 'quit' });
  await worddeduction.execute(ctx);
  assert.match(replies[0].text, /QUIT/);
  assert.match(replies[0].text, /CRANE/);
  assert.equal(games.hasSession(GROUP), false);
});

test('!worddeduction is refused while a different game is running, and leaves it untouched', async () => {
  const games = createGameManager({ logger: silent });
  const other = games.start(GROUP, { type: 'trivia', game: { onText() {} }, starterJid: MEMBER });
  const { ctx } = makeCtx(games, { args: ['crane'], argsText: 'crane' });
  await assert.rejects(() => worddeduction.execute(ctx), (error) => {
    assert.ok(error instanceof CommandError);
    assert.match(error.message, /already running/);
    return true;
  });
  assert.equal(games.get(GROUP), other);
});

test('!worddeduction fails cleanly when the game engine is missing', async () => {
  const { ctx } = makeCtx(null);
  await assert.rejects(() => worddeduction.execute(ctx), CommandError);
});

test('!worddeduction works in a direct chat', async () => {
  const games = createGameManager({ logger: silent });
  const { ctx } = makeCtx(games, { chatJid: MEMBER, isGroup: false });
  await worddeduction.execute(ctx);
  assert.equal(games.get(MEMBER).type, 'worddeduction');
  games.shutdown();
});
