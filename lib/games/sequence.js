import { compactFrame } from '../formatter.js';
import { displayMention, pick } from '../helpers.js';
import { SEQUENCE_DIFFICULTIES, SEQUENCE_PUZZLES } from './sequence-data.js';

export { SEQUENCE_DIFFICULTIES, SEQUENCE_PUZZLES };

export const SEQUENCE_MAX_ATTEMPTS = 3;
export const SEQUENCE_IDLE_MS = 180_000;
export const SEQUENCE_DEFAULT_DIFFICULTY = 'easy';

const IDLE_TIMER = 'idle';
const NUMBER_PATTERN = /^\s*(-?\d{1,10})\s*$/;
const QUIT_COMMANDS = new Set(['quit', 'stop', 'end']);
const STATUS_COMMANDS = new Set(['status']);
const DIFFICULTY_ALIASES = Object.freeze({
  easy: 'easy',
  e: 'easy',
  '1': 'easy',
  medium: 'medium',
  med: 'medium',
  m: 'medium',
  '2': 'medium',
  hard: 'hard',
  h: 'hard',
  '3': 'hard',
});

const recentPuzzleIds = new Map();

export function isQuitCommand(text) {
  if (typeof text !== 'string') return false;
  return QUIT_COMMANDS.has(text.trim().toLowerCase());
}

export function isStatusCommand(text) {
  if (typeof text !== 'string') return false;
  return STATUS_COMMANDS.has(text.trim().toLowerCase());
}

export function parseDifficulty(text) {
  if (typeof text !== 'string') return null;
  const key = text.trim().toLowerCase();
  return Object.hasOwn(DIFFICULTY_ALIASES, key) ? DIFFICULTY_ALIASES[key] : null;
}

export function parseSequenceAnswer(text) {
  if (typeof text !== 'string') return null;
  const match = text.match(NUMBER_PATTERN);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isSafeInteger(value) ? value : null;
}

export function formatSequence(terms) {
  if (!Array.isArray(terms)) return '?';
  return `${terms.join(', ')}, ?`;
}

export function validatePuzzle(puzzle) {
  if (!puzzle || typeof puzzle !== 'object') {
    throw new TypeError('A sequence puzzle must be an object.');
  }
  if (typeof puzzle.id !== 'string' || !puzzle.id.trim()) {
    throw new TypeError('A sequence puzzle needs an id.');
  }
  if (!SEQUENCE_DIFFICULTIES.includes(puzzle.difficulty)) {
    throw new TypeError('A sequence puzzle needs a valid difficulty.');
  }
  if (!Array.isArray(puzzle.sequence) || puzzle.sequence.length < 3) {
    throw new TypeError('A sequence puzzle needs at least three terms.');
  }
  if (puzzle.sequence.some((term) => !Number.isInteger(term))) {
    throw new TypeError('Every sequence term must be an integer.');
  }
  if (!Number.isInteger(puzzle.answer)) {
    throw new TypeError('A sequence puzzle needs an integer answer.');
  }
  if (typeof puzzle.rule !== 'string' || !puzzle.rule.trim()) {
    throw new TypeError('A sequence puzzle needs a documented rule.');
  }
  return puzzle;
}

export function puzzlesForDifficulty(difficulty, puzzles = SEQUENCE_PUZZLES) {
  return puzzles.filter((puzzle) => puzzle.difficulty === difficulty);
}

export function getRecentPuzzleId(chatJid) {
  return recentPuzzleIds.get(chatJid) || null;
}

export function rememberPuzzleId(chatJid, id) {
  if (chatJid && id) recentPuzzleIds.set(chatJid, id);
}

export function pickSequencePuzzle(difficulty, {
  random = Math.random,
  excludeId = null,
  puzzles = SEQUENCE_PUZZLES,
} = {}) {
  if (!SEQUENCE_DIFFICULTIES.includes(difficulty)) {
    throw new TypeError(`Unknown sequence difficulty "${difficulty}".`);
  }
  const pool = puzzlesForDifficulty(difficulty, puzzles);
  if (pool.length === 0) {
    throw new TypeError(`No sequence puzzles for difficulty "${difficulty}".`);
  }
  const candidates = excludeId && pool.length > 1
    ? pool.filter((puzzle) => puzzle.id !== excludeId)
    : pool;
  return pick(candidates, random);
}

function attemptsLine(data) {
  return `ATTEMPTS: ${data.attempts}/${data.maxAttempts}`;
}

function puzzleLine(data) {
  return `SEQUENCE: ${formatSequence(data.puzzle.sequence)}`;
}

function difficultyLine(data) {
  return `DIFFICULTY: ${data.difficulty.toUpperCase()}`;
}

export function describeSequenceStart(session, prefix = '!') {
  const { data } = session;
  return compactFrame('SEQUENCE CHALLENGE', [
    difficultyLine(data),
    puzzleLine(data),
    `Find the next number. You have ${data.maxAttempts} valid guesses.`,
    `Reply with a number, or use ${prefix}sequence <number>.`,
    `Check progress with ${prefix}sequence, or quit with ${prefix}sequence quit.`,
  ]);
}

export function describeSequenceStatus(session) {
  const { data } = session;
  const lines = [difficultyLine(data), puzzleLine(data), attemptsLine(data)];
  if (data.guesses.length) lines.push(`TRIED: ${data.guesses.join(', ')}`);
  else lines.push('No valid guesses yet.');
  return compactFrame('SEQUENCE CHALLENGE — IN PROGRESS', lines);
}

function validateIdleMs(idleMs) {
  if (!Number.isFinite(idleMs) || idleMs < 0) {
    throw new TypeError('A sequence idle timeout must be a finite, non-negative number of milliseconds.');
  }
  return idleMs;
}

export function startSequence(games, chatJid, {
  starterJid = null,
  socket = null,
  random = Math.random,
  difficulty = SEQUENCE_DEFAULT_DIFFICULTY,
  puzzle = null,
  puzzles = SEQUENCE_PUZZLES,
  maxAttempts = SEQUENCE_MAX_ATTEMPTS,
  idleMs = SEQUENCE_IDLE_MS,
  excludeId = undefined,
} = {}) {
  const level = parseDifficulty(difficulty) || difficulty;
  if (!SEQUENCE_DIFFICULTIES.includes(level)) {
    throw new TypeError(`Unknown sequence difficulty "${difficulty}".`);
  }
  const skipId = excludeId === undefined ? getRecentPuzzleId(chatJid) : excludeId;
  const chosen = validatePuzzle(puzzle || pickSequencePuzzle(level, {
    random,
    excludeId: skipId,
    puzzles,
  }));
  const delay = validateIdleMs(idleMs);
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
    throw new TypeError('A sequence game needs a positive integer maxAttempts.');
  }

  const session = games.start(chatJid, {
    type: 'sequence',
    game: sequenceGame,
    starterJid,
    socket,
    data: {
      difficulty: chosen.difficulty,
      puzzle: chosen,
      maxAttempts,
      idleMs: delay,
      attempts: 0,
      guessed: new Set(),
      guesses: [],
    },
  });
  rememberPuzzleId(chatJid, chosen.id);
  armIdleTimer(session);
  return session;
}

function armIdleTimer(session) {
  session.setTimer(IDLE_TIMER, session.data.idleMs, async (current, api) => {
    const { puzzle } = current.data;
    api.end();
    await api.send(
      compactFrame('SEQUENCE CHALLENGE — TIMED OUT', [
        'I do not wait. You wasted my time.',
        `ANSWER: ${puzzle.answer}`,
        `RULE: ${puzzle.rule}`,
      ]),
    );
  });
}

export function quitSequence(session, senderJid = null) {
  if (!session || session.ended || session.type !== 'sequence') return null;
  const { puzzle } = session.data;
  session.clearTimer(IDLE_TIMER);
  session.api.end();
  const who = senderJid ? displayMention(senderJid) : 'Someone';
  return {
    kind: 'quit',
    text: compactFrame('SEQUENCE CHALLENGE — QUIT', [
      `${who} walked away. Fine. You were never worth finishing.`,
      `ANSWER: ${puzzle.answer}`,
      `RULE: ${puzzle.rule}`,
    ]),
    mentions: senderJid ? [senderJid] : [],
  };
}

/**
 * Applies one numeric guess. Fully synchronous so two guesses arriving
 * together cannot both win or both consume the last attempt.
 *
 * Returns null when the session is gone or the value is not an integer;
 * otherwise `{ kind, text, mentions }` where kind is one of
 * 'duplicate' | 'miss' | 'win' | 'loss'.
 */
export function processSequence(session, value, senderJid = null) {
  if (!session || session.ended || session.type !== 'sequence') return null;
  if (!Number.isInteger(value)) return null;

  const { data } = session;
  const { puzzle } = data;
  if (data.guessed.has(value)) {
    return {
      kind: 'duplicate',
      text: compactFrame('SEQUENCE CHALLENGE — ALREADY TRIED', [
        `${value} was already guessed. Pay attention.`,
        attemptsLine(data),
      ]),
      mentions: [],
    };
  }

  data.guessed.add(value);
  data.guesses.push(value);
  data.attempts += 1;

  const mentions = senderJid ? [senderJid] : [];
  const who = senderJid ? displayMention(senderJid) : 'Someone';

  if (value === puzzle.answer) {
    session.clearTimer(IDLE_TIMER);
    session.api.end();
    return {
      kind: 'win',
      text: compactFrame('SEQUENCE CHALLENGE — SOLVED', [
        `${who} found the next number: ${puzzle.answer}. Acceptable.`,
        `RULE: ${puzzle.rule}`,
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
      text: compactFrame('SEQUENCE CHALLENGE — FAILED', [
        `${value} was wrong. Your attempts are spent, and so is my patience.`,
        `ANSWER: ${puzzle.answer}`,
        `RULE: ${puzzle.rule}`,
      ]),
      mentions: [],
    };
  }

  armIdleTimer(session);
  return {
    kind: 'miss',
    text: compactFrame('SEQUENCE CHALLENGE', [
        `${value} is not the next number. Keep guessing, if you can.`,
      puzzleLine(data),
      attemptsLine(data),
    ]),
    mentions: [],
  };
}

export const sequenceGame = {
  async onText(session, input, api) {
    const value = parseSequenceAnswer(input?.text);
    if (value === null) return;
    const outcome = processSequence(session, value, input?.senderJid || null);
    if (!outcome) return;
    await api.send({ text: outcome.text, ...(outcome.mentions.length ? { mentions: outcome.mentions } : {}) });
  },
};
