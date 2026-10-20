import { compactFrame } from '../formatter.js';
import { CommandError, displayMention, pick } from '../helpers.js';
import { canonicalUserJid } from '../identity.js';
import { EMOJI_QUESTIONS, QUIZ_QUESTIONS, RIDDLES, TRIVIA_QUESTIONS } from './quiz-data.js';

const DEADLINE_TIMER = 'deadline';
const MAX_ANSWER_LENGTH = 120;
const ARTICLES = new Set(['the', 'a', 'an']);
const CHOICE_REPLY = /^\s*(\d{1,2})\s*$/;

/**
 * Per-game settings. `mode` 'text' = free-text answer, 'choice' = option number.
 * Timeouts follow the Ryder-MD reference (30s / 60s / 30s / 45s). The deadline
 * is fixed from the start of the round; chat messages never extend it.
 */
export const QUIZ_KINDS = Object.freeze({
  trivia: { title: '🧠 TRIVIA', mode: 'text', timeoutMs: 30_000, bank: TRIVIA_QUESTIONS },
  riddle: { title: '🤔 RIDDLE', mode: 'text', timeoutMs: 60_000, bank: RIDDLES },
  quiz: { title: '📝 QUIZ', mode: 'choice', timeoutMs: 30_000, bank: QUIZ_QUESTIONS },
  emojiquiz: { title: '🎭 EMOJI QUIZ', mode: 'text', timeoutMs: 45_000, bank: EMOJI_QUESTIONS },
});

/**
 * Normalizes an answer for exact comparison: strips accents, case,
 * punctuation and spacing, and drops a single leading "the/a/an" when more
 * words follow. "Spider-Man", "spider man" and "SPIDERMAN" all become
 * "spiderman". Returns '' when nothing comparable is left (e.g. emoji only).
 */
export function normalizeAnswer(value) {
  if (typeof value !== 'string' && typeof value !== 'number') return '';
  const cleaned = String(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
  const tokens = cleaned.split(' ').filter(Boolean);
  if (tokens.length > 1 && ARTICLES.has(tokens[0])) tokens.shift();
  return tokens.join('');
}

/** True when `text` is exactly one of the accepted answers (never a substring match). */
export function matchesAnswer(text, answers) {
  const given = normalizeAnswer(text);
  if (!given || !Array.isArray(answers)) return false;
  return answers.some((answer) => normalizeAnswer(answer) === given);
}

/** Throws a TypeError describing the first problem with a question, for the given mode. */
export function validateQuestion(question, mode) {
  if (!question || typeof question !== 'object') throw new TypeError('A quiz question must be an object.');
  if (typeof question.prompt !== 'string' || !question.prompt.trim()) throw new TypeError('A quiz question needs a prompt.');
  if (typeof question.display !== 'string' || !question.display.trim()) throw new TypeError('A quiz question needs a display answer.');
  if (mode === 'choice') {
    const { options, correct } = question;
    if (!Array.isArray(options) || options.length < 2 || options.length > 9) {
      throw new TypeError('A choice question needs 2 to 9 options.');
    }
    if (options.some((option) => typeof option !== 'string' || !option.trim())) {
      throw new TypeError('Every option must be a non-empty string.');
    }
    if (!Number.isInteger(correct) || correct < 0 || correct >= options.length) {
      throw new TypeError('A choice question needs a valid correct option index.');
    }
    return;
  }
  if (!Array.isArray(question.answers) || question.answers.length === 0) {
    throw new TypeError('A text question needs at least one accepted answer.');
  }
  if (question.answers.some((answer) => !normalizeAnswer(answer))) {
    throw new TypeError('Every accepted answer must contain letters or digits.');
  }
}

/** Opening message for a fresh round. */
export function describeQuizStart(session) {
  const { data } = session;
  const kind = QUIZ_KINDS[data.kind];
  const seconds = Math.round(data.timeoutMs / 1000);
  const { question } = data;
  const lines = [`❓ ${question.prompt}`];
  if (kind.mode === 'choice') {
    lines.push(...question.options.map((option, index) => `${index + 1}. ${option}`));
    lines.push(`Reply with the option number (1-${question.options.length}). One try per player.`);
  } else {
    if (question.hint) lines.push(`💡 HINT: ${question.hint}`);
    lines.push('Type your answer in the chat.');
  }
  lines.push(`⏳ You have ${seconds} seconds.`);
  return compactFrame(kind.title, lines);
}

/**
 * Starts a round through the shared manager. Throws the manager's
 * CommandError when any game is already running in the chat. `question` and
 * `timeoutMs` may be injected (tests); otherwise a random question is picked.
 */
export function startQuiz(games, chatJid, kindName, {
  starterJid = null,
  socket = null,
  random = Math.random,
  question = null,
  timeoutMs = null,
} = {}) {
  if (!Object.hasOwn(QUIZ_KINDS, kindName)) throw new TypeError(`Unknown quiz game "${kindName}".`);
  const kind = QUIZ_KINDS[kindName];
  const chosen = question || pick(kind.bank, random);
  validateQuestion(chosen, kind.mode);
  const delay = timeoutMs ?? kind.timeoutMs;
  // Validate before starting: setTimer rejects a bad delay, and by then the
  // session would already be registered with no deadline.
  if (!Number.isFinite(delay) || delay < 0) {
    throw new TypeError('A quiz timeout must be a finite, non-negative number of milliseconds.');
  }

  const session = games.start(chatJid, {
    type: kindName,
    game: quizGame,
    starterJid,
    socket,
    data: { kind: kindName, question: chosen, timeoutMs: delay, locked: new Set() },
  });
  session.setTimer(DEADLINE_TIMER, delay, async (current, api) => {
    // End first so late answers are not routed while the notice is in flight.
    api.end();
    await api.send(
      compactFrame("⏰ TIME'S UP", ['I do not wait. You wasted my time.', `ANSWER: ${current.data.question.display}`]),
    );
  });
  return session;
}

function winOutcome(session, senderJid) {
  const { question } = session.data;
  session.api.end();
  return {
    kind: 'win',
    text: compactFrame('🎉 CORRECT', [
      `${senderJid ? displayMention(senderJid) : 'Someone'} got it. Acceptable.`,
      `ANSWER: ${question.display}`,
    ]),
    mentions: senderJid ? [senderJid] : [],
  };
}

/**
 * Judges one plain-text message. Fully synchronous (no awaits) so two answers
 * arriving together can never both win.
 *
 * Returns null when the message should be ignored (session gone, chatter,
 * unrelated numbers, a wrong free-text answer, a locked-out player). Otherwise
 * `{ kind, text, mentions }` with kind 'win' | 'wrong' | 'loss'; the caller sends it.
 *
 * Free-text games ignore wrong answers silently, so ordinary chat can never
 * consume anything or disturb the round. In the choice quiz each player gets
 * one try: a wrong option number locks that player out, and in a direct chat
 * (a single player) it ends the round.
 */
export function processAnswer(session, text, { senderJid = null, groupMeta = null, isGroup = true } = {}) {
  if (!session || session.ended || !Object.hasOwn(QUIZ_KINDS, session.type)) return null;
  if (typeof text !== 'string' || text.length > MAX_ANSWER_LENGTH) return null;
  const { question, locked } = session.data;
  const kind = QUIZ_KINDS[session.type];

  if (kind.mode === 'text') {
    return matchesAnswer(text, question.answers) ? winOutcome(session, senderJid) : null;
  }

  const match = text.match(CHOICE_REPLY);
  if (!match) return null;
  const choice = Number(match[1]);
  if (choice < 1 || choice > question.options.length) return null;

  const player = canonicalUserJid(groupMeta, senderJid) || senderJid || 'unknown';
  if (locked.has(player)) return null;

  if (choice - 1 === question.correct) return winOutcome(session, senderJid);

  if (!isGroup) {
    session.api.end();
    return {
      kind: 'loss',
      text: compactFrame('💀 WRONG ANSWER', [`${choice} is not correct. Even that was beyond you?`, `ANSWER: ${question.display}`]),
      mentions: [],
    };
  }
  locked.add(player);
  return {
    kind: 'wrong',
    text: compactFrame('❌ WRONG', [
      `${senderJid ? displayMention(senderJid) : 'That player'} chose ${choice} and is out of this round. Pathetic.`,
    ]),
    mentions: senderJid ? [senderJid] : [],
  };
}

/** Game object registered with the manager: routes plain-text answers. */
export const quizGame = {
  async onText(session, input, api) {
    const outcome = processAnswer(session, input?.text, {
      senderJid: input?.senderJid || null,
      groupMeta: input?.groupMeta || null,
      isGroup: input?.isGroup !== false,
    });
    if (!outcome) return;
    await api.send({ text: outcome.text, ...(outcome.mentions.length ? { mentions: outcome.mentions } : {}) });
  },
};

/** Shared body of the four commands: start a round and announce it. */
export async function runQuizCommand(ctx, kindName) {
  if (!ctx.games) throw new CommandError('The game engine is not available.');
  const session = startQuiz(ctx.games, ctx.chatJid, kindName, {
    starterJid: ctx.senderJid,
    socket: ctx.sock || null,
  });
  await ctx.reply(describeQuizStart(session));
}