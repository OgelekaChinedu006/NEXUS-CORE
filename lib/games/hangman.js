import { compactFrame } from '../formatter.js';
import { displayMention, pick } from '../helpers.js';

export const HANGMAN_MAX_ATTEMPTS = 6;
export const HANGMAN_IDLE_MS = 180_000;
export const HANGMAN_MIN_LENGTH = 4;
export const HANGMAN_MAX_LENGTH = 10;

const IDLE_TIMER = 'idle';
const LETTER_PATTERN = /^\s*([a-zA-Z])\s*$/;
const QUIT_COMMANDS = new Set(['quit', 'stop', 'end']);
const STATUS_COMMANDS = new Set(['status']);

export const HANGMAN_FIGURES = Object.freeze([
  Object.freeze(['+---+', '|   |', '    |', '    |', '    |', '    |', '=====']),
  Object.freeze(['+---+', '|   |', 'O   |', '    |', '    |', '    |', '=====']),
  Object.freeze(['+---+', '|   |', 'O   |', '|   |', '    |', '    |', '=====']),
  Object.freeze(['+---+', '|   |', 'O   |', '/|  |', '    |', '    |', '=====']),
  Object.freeze(['+---+', '|   |', 'O   |', '/|\\ |', '    |', '    |', '=====']),
  Object.freeze(['+---+', '|   |', 'O   |', '/|\\ |', '/   |', '    |', '=====']),
  Object.freeze(['+---+', '|   |', 'O   |', '/|\\ |', '/ \\ |', '    |', '=====']),
]);

export const HANGMAN_WORDS = Object.freeze([
  'apple', 'banana', 'castle', 'dragon', 'forest', 'galaxy', 'hammer', 'island',
  'jungle', 'knight', 'letter', 'magnet', 'nebula', 'oracle', 'planet', 'quartz',
  'river', 'shadow', 'temple', 'umbra', 'valley', 'wizard', 'xenon', 'yellow',
  'zephyr', 'anchor', 'bridge', 'cinder', 'domain', 'ember', 'falcon', 'garden',
  'harbor', 'ivory', 'jasper', 'keeper', 'lantern', 'mirror', 'nectar', 'obsidian',
  'phoenix', 'quiver', 'rune', 'silver', 'thunder', 'violet', 'whisper', 'voyage',
  'willow', 'cipher', 'blizzard', 'crystal', 'dungeon', 'eclipse', 'furnace',
  'griffin', 'horizon', 'inferno', 'javelin', 'kingdom', 'labyrinth', 'monarch',
  'nightfall', 'overlord', 'phantom', 'riddle', 'sanctum', 'tyrant', 'vortex',
  'warlock', 'abyss', 'beacon', 'chalice', 'dusk', 'echo', 'flame', 'glyph',
]);

export function isQuitCommand(text) {
  if (typeof text !== 'string') return false;
  return QUIT_COMMANDS.has(text.trim().toLowerCase());
}

export function isStatusCommand(text) {
  if (typeof text !== 'string') return false;
  return STATUS_COMMANDS.has(text.trim().toLowerCase());
}

export function parseHangmanLetter(text) {
  if (typeof text !== 'string') return null;
  const match = text.match(LETTER_PATTERN);
  return match ? match[1].toLowerCase() : null;
}

export function normalizeHangmanWord(word) {
  return typeof word === 'string' ? word.trim().toLowerCase() : '';
}

export function isHangmanWord(value) {
  const word = normalizeHangmanWord(value);
  return (
    word.length >= HANGMAN_MIN_LENGTH
    && word.length <= HANGMAN_MAX_LENGTH
    && /^[a-z]+$/.test(word)
  );
}

export function isHangmanLetter(value) {
  return typeof value === 'string' && /^[a-z]$/.test(value.trim().toLowerCase()) && value.trim().length === 1;
}

export function maskWord(answer, guessed) {
  const word = normalizeHangmanWord(answer);
  const known = guessed instanceof Set ? guessed : new Set();
  return [...word].map((letter) => (known.has(letter) ? letter.toUpperCase() : '_')).join(' ');
}

export function isWordRevealed(answer, guessed) {
  const word = normalizeHangmanWord(answer);
  if (!word) return false;
  const known = guessed instanceof Set ? guessed : new Set();
  return [...word].every((letter) => known.has(letter));
}

export function hangmanFigure(misses) {
  const index = Math.min(Math.max(Number(misses) || 0, 0), HANGMAN_FIGURES.length - 1);
  return HANGMAN_FIGURES[index];
}

function guessedLine(data) {
  const letters = [...data.guessed].sort().map((letter) => letter.toUpperCase());
  return letters.length ? `GUESSED: ${letters.join(' ')}` : 'GUESSED: none';
}

function missesLine(data) {
  return `MISSES: ${data.attempts}/${data.maxAttempts}`;
}

function wordLine(data) {
  return `WORD: ${maskWord(data.answer, data.guessed)}`;
}

export function describeHangmanStart(session, prefix = '!') {
  const { data } = session;
  return compactFrame('HANGMAN', [
    `I am thinking of a ${data.answer.length}-letter word.`,
    `You have ${data.maxAttempts} misses before the figure is complete.`,
    wordLine(data),
    `Reply with a single letter, or use ${prefix}hangman <letter>.`,
    `Check progress with ${prefix}hangman, or quit with ${prefix}hangman quit.`,
  ]);
}

export function describeHangmanStatus(session) {
  const { data } = session;
  return compactFrame('HANGMAN — IN PROGRESS', [
    ...hangmanFigure(data.attempts),
    wordLine(data),
    guessedLine(data),
    missesLine(data),
  ]);
}

function validateAnswer(answer) {
  if (!isHangmanWord(answer)) {
    throw new TypeError('A hangman answer must be a 4–10 letter word.');
  }
  return normalizeHangmanWord(answer);
}

function validateIdleMs(idleMs) {
  if (!Number.isFinite(idleMs) || idleMs < 0) {
    throw new TypeError('A hangman idle timeout must be a finite, non-negative number of milliseconds.');
  }
  return idleMs;
}

export function startHangman(games, chatJid, {
  starterJid = null,
  socket = null,
  random = Math.random,
  answer = null,
  words = HANGMAN_WORDS,
  maxAttempts = HANGMAN_MAX_ATTEMPTS,
  idleMs = HANGMAN_IDLE_MS,
} = {}) {
  const chosen = validateAnswer(answer || pick(words, random));
  const delay = validateIdleMs(idleMs);
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
    throw new TypeError('A hangman game needs a positive integer maxAttempts.');
  }

  const session = games.start(chatJid, {
    type: 'hangman',
    game: hangmanGame,
    starterJid,
    socket,
    data: {
      maxAttempts,
      idleMs: delay,
      attempts: 0,
      guessed: new Set(),
      answer: chosen,
    },
  });
  armIdleTimer(session);
  return session;
}

function armIdleTimer(session) {
  session.setTimer(IDLE_TIMER, session.data.idleMs, async (current, api) => {
    const secret = current.data.answer;
    api.end();
    await api.send(
      compactFrame('HANGMAN — TIMED OUT', [
        'I do not wait. You wasted my time.',
        `The word was ${secret.toUpperCase()}.`,
      ]),
    );
  });
}

export function quitHangman(session, senderJid = null) {
  if (!session || session.ended || session.type !== 'hangman') return null;
  const secret = session.data.answer;
  session.clearTimer(IDLE_TIMER);
  session.api.end();
  const who = senderJid ? displayMention(senderJid) : 'Someone';
  return {
    kind: 'quit',
    text: compactFrame('HANGMAN — QUIT', [
      `${who} walked away. Fine. You were never worth finishing.`,
      `The word was ${secret.toUpperCase()}.`,
    ]),
    mentions: senderJid ? [senderJid] : [],
  };
}

/**
 * Applies one letter guess. Fully synchronous so two guesses arriving
 * together cannot both win or both consume the last miss.
 *
 * Returns null when the session is gone or the value is not a letter;
 * otherwise `{ kind, text, mentions }` where kind is one of
 * 'duplicate' | 'hit' | 'miss' | 'win' | 'loss'.
 */
export function processHangman(session, value, senderJid = null) {
  if (!session || session.ended || session.type !== 'hangman') return null;
  const letter = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!/^[a-z]$/.test(letter)) return null;

  const { data } = session;
  if (data.guessed.has(letter)) {
    return {
      kind: 'duplicate',
      text: compactFrame('HANGMAN — ALREADY TRIED', [
        `${letter.toUpperCase()} was already guessed. Pay attention.`,
        wordLine(data),
        missesLine(data),
      ]),
      mentions: [],
    };
  }

  data.guessed.add(letter);
  const hit = data.answer.includes(letter);
  if (!hit) data.attempts += 1;

  const mentions = senderJid ? [senderJid] : [];
  const who = senderJid ? displayMention(senderJid) : 'Someone';
  const board = [...hangmanFigure(data.attempts), wordLine(data), guessedLine(data), missesLine(data)];

  if (isWordRevealed(data.answer, data.guessed)) {
    session.clearTimer(IDLE_TIMER);
    session.api.end();
    return {
      kind: 'win',
      text: compactFrame('HANGMAN — SOLVED', [
        `${who} saved the word: ${data.answer.toUpperCase()}. Acceptable.`,
        wordLine(data),
        `Misses used: ${data.attempts}/${data.maxAttempts}.`,
      ]),
      mentions,
    };
  }

  if (data.attempts >= data.maxAttempts) {
    session.clearTimer(IDLE_TIMER);
    session.api.end();
    return {
      kind: 'loss',
      text: compactFrame('HANGMAN — HANGED', [
        ...hangmanFigure(data.attempts),
        `${letter.toUpperCase()} was wrong. The figure is complete, and so is your failure.`,
        `The word was ${data.answer.toUpperCase()}.`,
      ]),
      mentions: [],
    };
  }

  armIdleTimer(session);
  if (hit) {
    return {
      kind: 'hit',
      text: compactFrame('HANGMAN — HIT', [
        `${letter.toUpperCase()} is in the word.`,
        ...board,
      ]),
      mentions: [],
    };
  }

  return {
    kind: 'miss',
    text: compactFrame('HANGMAN — MISS', [
        `${letter.toUpperCase()} is not in the word. Obvious.`,
      ...board,
    ]),
    mentions: [],
  };
}

export const hangmanGame = {
  async onText(session, input, api) {
    const letter = parseHangmanLetter(input?.text);
    if (letter === null) return;
    const outcome = processHangman(session, letter, input?.senderJid || null);
    if (!outcome) return;
    await api.send({ text: outcome.text, ...(outcome.mentions.length ? { mentions: outcome.mentions } : {}) });
  },
};
