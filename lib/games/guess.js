import { compactFrame } from '../formatter.js';
import { displayMention, randomInt } from '../helpers.js';

export const GUESS_MIN = 1;
export const GUESS_MAX = 100;
export const GUESS_MAX_ATTEMPTS = 7;
export const GUESS_IDLE_MS = 120_000;

const IDLE_TIMER = 'idle';
const PLAIN_NUMBER = /^\s*(\d{1,6})\s*$/;

/**
 * Plain-text routing only reacts to a message that is a bare integer, so
 * ordinary chat in the group is never answered. Returns the integer, or null.
 */
export function parseGuessText(text) {
  if (typeof text !== 'string') return null;
  const match = text.match(PLAIN_NUMBER);
  return match ? Number(match[1]) : null;
}

export function isInGuessRange(value, { min = GUESS_MIN, max = GUESS_MAX } = {}) {
  return Number.isInteger(value) && value >= min && value <= max;
}

function attemptsLine(data) {
  return `🎯 ATTEMPTS: ${data.attempts}/${data.maxAttempts}`;
}

function rangeLine(data) {
  return `📏 RANGE: ${data.low} – ${data.high}`;
}

/** Opening message for a fresh session. */
export function describeGuessStart(session, prefix = '!') {
  const { data } = session;
  return compactFrame('🔢 GUESS THE NUMBER', [
    `I am thinking of a number between ${data.min} and ${data.max}.`,
    `You have ${data.maxAttempts} attempts.`,
    `Reply with a number, or use ${prefix}guess <number>.`,
  ]);
}

/** Status message for an already-running session. */
export function describeGuessStatus(session) {
  const { data } = session;
  return compactFrame('🔢 GUESS IN PROGRESS', [attemptsLine(data), rangeLine(data)]);
}

/**
 * Starts a guess game for the chat through the shared manager. Throws the
 * manager's CommandError when any game is already running in that chat.
 */
export function startGuess(games, chatJid, {
  starterJid = null,
  socket = null,
  random = Math.random,
  min = GUESS_MIN,
  max = GUESS_MAX,
  maxAttempts = GUESS_MAX_ATTEMPTS,
  idleMs = GUESS_IDLE_MS,
} = {}) {
  const session = games.start(chatJid, {
    type: 'guess',
    game: guessGame,
    starterJid,
    socket,
    data: {
      min,
      max,
      low: min,
      high: max,
      maxAttempts,
      idleMs,
      attempts: 0,
      guessed: new Set(),
      answer: randomInt(min, max, random),
    },
  });
  armIdleTimer(session);
  return session;
}

function armIdleTimer(session) {
  session.setTimer(IDLE_TIMER, session.data.idleMs, async (current, api) => {
    const answer = current.data.answer;
    // End first so late guesses are not routed while the notice is in flight.
    api.end();
    await api.send(
      compactFrame('⌛ GAME TIMED OUT', [
        'I do not wait. You wasted my time.',
        `The number was ${answer}.`,
      ]),
    );
  });
}

/**
 * Applies one guess. Fully synchronous (no awaits), so two guesses arriving
 * together can never both win or both consume the last attempt.
 *
 * Returns null when the session is gone or the value is not an in-range
 * integer; otherwise `{ kind, text, mentions }` where kind is one of
 * 'duplicate' | 'low' | 'high' | 'win' | 'loss'. The caller sends `text`.
 */
export function processGuess(session, value, senderJid = null) {
  if (!session || session.ended || session.type !== 'guess') return null;
  const { data } = session;
  if (!isInGuessRange(value, data)) return null;

  if (data.guessed.has(value)) {
    return {
      kind: 'duplicate',
      text: compactFrame('🔢 ALREADY TRIED', [`${value} was already guessed. Pay attention.`, attemptsLine(data)]),
      mentions: [],
    };
  }

  data.guessed.add(value);
  data.attempts += 1;
  const mentions = senderJid ? [senderJid] : [];
  const who = senderJid ? displayMention(senderJid) : 'Someone';

  if (value === data.answer) {
    session.clearTimer(IDLE_TIMER);
    session.api.end();
    return {
      kind: 'win',
      text: compactFrame('🎉 CORRECT', [
        `${who} found the number: ${data.answer}. Acceptable.`,
        `Attempts used: ${data.attempts}/${data.maxAttempts}.`,
      ]),
      mentions,
    };
  }

  if (data.attempts >= data.maxAttempts) {
    session.clearTimer(IDLE_TIMER);
    session.api.end();
    return {
      kind: 'loss',
      text: compactFrame('💀 GAME OVER', [
        `${value} was wrong. Your attempts are spent, and so is my patience.`,
        `The number was ${data.answer}.`,
      ]),
      mentions: [],
    };
  }

  const kind = value < data.answer ? 'low' : 'high';
  if (kind === 'low') data.low = Math.max(data.low, value + 1);
  else data.high = Math.min(data.high, value - 1);
  armIdleTimer(session);
  return {
    kind,
    text: compactFrame(kind === 'low' ? '📈 TOO LOW' : '📉 TOO HIGH', [
      `${value} is too ${kind}.`,
      attemptsLine(data),
      rangeLine(data),
    ]),
    mentions: [],
  };
}

/** Game object registered with the manager: handles plain-text guesses. */
export const guessGame = {
  async onText(session, input, api) {
    const value = parseGuessText(input?.text);
    if (value === null) return;
    const outcome = processGuess(session, value, input?.senderJid || null);
    if (!outcome) return;
    await api.send({ text: outcome.text, ...(outcome.mentions.length ? { mentions: outcome.mentions } : {}) });
  },
};
