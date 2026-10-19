import { compactFrame } from '../formatter.js';
import { displayMention, pick } from '../helpers.js';

export const WORD_DEDUCTION_WORD_LENGTH = 5;
export const WORD_DEDUCTION_MAX_ATTEMPTS = 6;
export const WORD_DEDUCTION_IDLE_MS = 180_000;

export const MARK_CORRECT = 'correct';
export const MARK_PRESENT = 'present';
export const MARK_ABSENT = 'absent';

const TILE = {
  [MARK_CORRECT]: '🟩',
  [MARK_PRESENT]: '🟨',
  [MARK_ABSENT]: '⬛',
};

const IDLE_TIMER = 'idle';
const WORD_PATTERN = new RegExp(`^\\s*([a-zA-Z]{${WORD_DEDUCTION_WORD_LENGTH}})\\s*$`);
const QUIT_COMMANDS = new Set(['quit', 'stop', 'end']);
const STATUS_COMMANDS = new Set(['status']);

export const WORD_DEDUCTION_WORDS = Object.freeze([
  'about', 'above', 'actor', 'acute', 'admit', 'adopt', 'after', 'again',
  'agent', 'agree', 'ahead', 'alarm', 'album', 'alert', 'alien', 'align',
  'alike', 'alive', 'allow', 'alone', 'along', 'alter', 'amber', 'amend',
  'angel', 'anger', 'angle', 'angry', 'apart', 'apple', 'apply', 'arena',
  'argue', 'arise', 'armor', 'aroma', 'array', 'arrow', 'aside', 'asset',
  'audio', 'audit', 'avoid', 'awake', 'award', 'aware', 'badly', 'baker',
  'basic', 'beach', 'begin', 'being', 'below', 'bench', 'birth', 'black',
  'blame', 'blank', 'blast', 'blaze', 'bleed', 'bless', 'blind', 'block',
  'blood', 'bloom', 'board', 'boast', 'bonus', 'boost', 'bound', 'brain',
  'brand', 'brave', 'bread', 'break', 'breed', 'brick', 'bride', 'brief',
  'bring', 'broad', 'broke', 'brown', 'build', 'built', 'buyer', 'cabin',
  'cable', 'camel', 'candy', 'cargo', 'carry', 'catch', 'cause', 'chain',
  'chair', 'chalk', 'chaos', 'charm', 'chart', 'chase', 'cheap', 'check',
  'chest', 'chief', 'child', 'choir', 'claim', 'class', 'clean', 'clear',
  'clerk', 'click', 'cliff', 'climb', 'clock', 'close', 'cloud', 'coach',
  'coast', 'crane', 'crate', 'crazy', 'cream', 'creek', 'crime', 'crisp',
  'cross', 'crowd', 'crown', 'crude', 'cruel', 'crush', 'curve', 'cycle',
  'daily', 'dance', 'dealt', 'death', 'debug', 'delay', 'delta', 'demon',
  'depth', 'diary', 'digit', 'dirty', 'doubt', 'dozen', 'draft', 'drain',
  'drama', 'dream', 'dress', 'drift', 'drink', 'drive', 'early', 'earth',
  'eight', 'elite', 'empty', 'enemy', 'enjoy', 'enter', 'entry', 'equal',
  'error', 'event', 'every', 'exact', 'exist', 'extra', 'fable', 'faith',
  'false', 'fancy', 'fault', 'favor', 'feast', 'field', 'fifth', 'fight',
  'final', 'first', 'flame', 'flash', 'fleet', 'flesh', 'float', 'flood',
  'floor', 'flora', 'flour', 'focus', 'force', 'forge', 'forth', 'found',
  'frame', 'frank', 'fresh', 'front', 'frost', 'frown', 'fruit', 'fully',
  'funny', 'giant', 'given', 'glass', 'globe', 'glory', 'grace', 'grade',
  'grain', 'grand', 'grant', 'grape', 'graph', 'grasp', 'grass', 'grave',
  'great', 'green', 'greet', 'grief', 'grind', 'gross', 'group', 'grove',
  'guard', 'guess', 'guest', 'guide', 'guild', 'guilt', 'habit', 'happy',
  'harsh', 'heart', 'heavy', 'hello', 'honey', 'honor', 'horse', 'hotel',
  'house', 'human', 'humor', 'hurry', 'ideal', 'image', 'imply', 'index',
  'inner', 'input', 'irate', 'issue', 'ivory', 'jewel', 'joint', 'jolly',
  'judge', 'juice', 'knife', 'knock', 'known', 'label', 'labor', 'large',
  'laser', 'later', 'laugh', 'layer', 'learn', 'least', 'leave', 'legal',
  'lemon', 'level', 'light', 'limit', 'linen', 'liver', 'lobby', 'local',
  'logic', 'loose', 'lucky', 'lunar', 'lunch', 'magic', 'major', 'maker',
  'maple', 'march', 'match', 'maybe', 'mayor', 'medal', 'media', 'mercy',
  'merit', 'metal', 'might', 'minor', 'minus', 'model', 'money', 'month',
  'moral', 'motor', 'mount', 'mouth', 'music', 'naive', 'nasty', 'naval',
  'nerve', 'never', 'night', 'noble', 'noise', 'north', 'novel', 'nurse',
  'occur', 'ocean', 'offer', 'often', 'olive', 'onion', 'opera', 'orbit',
  'order', 'organ', 'other', 'outer', 'owner', 'oxide', 'paint', 'panel',
  'paper', 'party', 'peace', 'phase', 'phone', 'photo', 'piano', 'piece',
  'pilot', 'pitch', 'place', 'plain', 'plane', 'plant', 'plate', 'plaza',
  'point', 'polar', 'porch', 'pound', 'power', 'press', 'price', 'pride',
  'prime', 'print', 'prior', 'prize', 'proof', 'proud', 'prove', 'proxy',
  'pulse', 'punch', 'pupil', 'queen', 'query', 'quest', 'quick', 'quiet',
  'quite', 'quote', 'radio', 'raise', 'rally', 'range', 'rapid', 'ratio',
  'reach', 'react', 'ready', 'realm', 'rebel', 'refer', 'relax', 'reply',
  'rider', 'ridge', 'right', 'rigid', 'rival', 'river', 'robot', 'rough',
  'round', 'route', 'royal', 'rugby', 'ruler', 'rural', 'saint', 'salad',
  'scale', 'scare', 'scene', 'scope', 'score', 'scout', 'sense', 'serve',
  'seven', 'shade', 'shake', 'shall', 'shame', 'shape', 'share', 'sharp',
  'sheep', 'sheet', 'shelf', 'shell', 'shift', 'shine', 'shirt', 'shock',
  'shore', 'short', 'shout', 'sight', 'sigma', 'silly', 'since', 'skill',
  'slave', 'sleep', 'slice', 'slide', 'small', 'smart', 'smile', 'smoke',
  'snake', 'solar', 'solid', 'solve', 'sorry', 'sound', 'south', 'space',
  'spare', 'speak', 'speed', 'spend', 'spice', 'spike', 'spine', 'split',
  'spoil', 'sport', 'spray', 'squad', 'stack', 'staff', 'stage', 'stain',
  'stair', 'stake', 'stand', 'stare', 'start', 'state', 'steam', 'steel',
  'steep', 'steer', 'stern', 'stick', 'still', 'stock', 'stone', 'store',
  'storm', 'story', 'stove', 'straw', 'strip', 'stuck', 'study', 'stuff',
  'style', 'sugar', 'suite', 'super', 'surge', 'swamp', 'swear', 'sweep',
  'sweet', 'swift', 'swing', 'sword', 'table', 'taste', 'teach', 'thank',
  'their', 'theme', 'there', 'thick', 'thief', 'thing', 'think', 'third',
  'thorn', 'those', 'three', 'throw', 'thumb', 'tiger', 'tight', 'title',
  'toast', 'today', 'token', 'tooth', 'topic', 'torch', 'total', 'touch',
  'tough', 'tower', 'toxic', 'trace', 'track', 'trade', 'trail', 'train',
  'trait', 'trash', 'treat', 'trend', 'trial', 'tribe', 'trick', 'troop',
  'truck', 'truly', 'trust', 'truth', 'twice', 'twist', 'ultra', 'uncle',
  'under', 'union', 'unity', 'until', 'upper', 'upset', 'urban', 'usage',
  'usual', 'vague', 'valid', 'value', 'vapor', 'vault', 'venue', 'verse',
  'video', 'virus', 'visit', 'vital', 'vivid', 'vocal', 'voice', 'voter',
  'wagon', 'waste', 'watch', 'water', 'weary', 'whale', 'wheat', 'wheel',
  'where', 'which', 'while', 'white', 'whole', 'whose', 'widen', 'width',
  'witch', 'woman', 'world', 'worry', 'worth', 'wound', 'woven', 'wreck',
  'write', 'wrong', 'yield', 'young', 'youth',
]);

export function isQuitCommand(text) {
  if (typeof text !== 'string') return false;
  return QUIT_COMMANDS.has(text.trim().toLowerCase());
}

export function isStatusCommand(text) {
  if (typeof text !== 'string') return false;
  return STATUS_COMMANDS.has(text.trim().toLowerCase());
}

export function parseWordDeduction(text) {
  if (typeof text !== 'string') return null;
  const match = text.match(WORD_PATTERN);
  return match ? match[1].toLowerCase() : null;
}

export function normalizeWordDeduction(word) {
  return typeof word === 'string' ? word.trim().toLowerCase() : '';
}

export function isFiveLetterWord(value) {
  const word = normalizeWordDeduction(value);
  return word.length === WORD_DEDUCTION_WORD_LENGTH && /^[a-z]+$/.test(word);
}

/**
 * Wordle-style marks. Greens are assigned first and consume those answer
 * letters; yellows then consume remaining unmatched occurrences.
 */
export function scoreGuess(answer, guess) {
  if (!isFiveLetterWord(answer) || !isFiveLetterWord(guess)) return null;
  const answerChars = [...normalizeWordDeduction(answer)];
  const guessChars = [...normalizeWordDeduction(guess)];
  const marks = Array(WORD_DEDUCTION_WORD_LENGTH).fill(MARK_ABSENT);
  const remaining = [...answerChars];

  for (let index = 0; index < WORD_DEDUCTION_WORD_LENGTH; index += 1) {
    if (guessChars[index] === answerChars[index]) {
      marks[index] = MARK_CORRECT;
      remaining[index] = null;
    }
  }

  for (let index = 0; index < WORD_DEDUCTION_WORD_LENGTH; index += 1) {
    if (marks[index] === MARK_CORRECT) continue;
    const found = remaining.indexOf(guessChars[index]);
    if (found !== -1) {
      marks[index] = MARK_PRESENT;
      remaining[found] = null;
    }
  }

  return marks;
}

export function formatMarks(marks) {
  if (!Array.isArray(marks)) return '';
  return marks.map((mark) => TILE[mark] || TILE[MARK_ABSENT]).join('');
}

function attemptsLine(data) {
  return `ATTEMPTS: ${data.attempts}/${data.maxAttempts}`;
}

function historyLines(data) {
  return data.guesses.map((entry) => `${entry.word.toUpperCase()} ${formatMarks(entry.marks)}`);
}

export function describeWordDeductionStart(session, prefix = '!') {
  const { data } = session;
  return compactFrame('WORD DEDUCTION', [
    `I am thinking of a ${data.wordLength}-letter word.`,
    `You have ${data.maxAttempts} valid guesses.`,
    '🟩 correct letter and position.',
    '🟨 letter exists but is in the wrong position.',
    '⬛ letter is absent from the remaining unmatched letters.',
    `Reply with a ${data.wordLength}-letter word, or use ${prefix}worddeduction <word>.`,
    `Check progress with ${prefix}worddeduction, or quit with ${prefix}worddeduction quit.`,
  ]);
}

export function describeWordDeductionStatus(session) {
  const { data } = session;
  const lines = [attemptsLine(data)];
  if (data.guesses.length) lines.push(...historyLines(data));
  else lines.push('No valid guesses yet.');
  return compactFrame('WORD DEDUCTION — IN PROGRESS', lines);
}

function validateAnswer(answer) {
  if (!isFiveLetterWord(answer)) {
    throw new TypeError('A word-deduction answer must be a five-letter word.');
  }
  return normalizeWordDeduction(answer);
}

function validateIdleMs(idleMs) {
  if (!Number.isFinite(idleMs) || idleMs < 0) {
    throw new TypeError('A word-deduction idle timeout must be a finite, non-negative number of milliseconds.');
  }
  return idleMs;
}

export function startWordDeduction(games, chatJid, {
  starterJid = null,
  socket = null,
  random = Math.random,
  answer = null,
  words = WORD_DEDUCTION_WORDS,
  maxAttempts = WORD_DEDUCTION_MAX_ATTEMPTS,
  idleMs = WORD_DEDUCTION_IDLE_MS,
} = {}) {
  const chosen = validateAnswer(answer || pick(words, random));
  const delay = validateIdleMs(idleMs);
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
    throw new TypeError('A word-deduction game needs a positive integer maxAttempts.');
  }

  const session = games.start(chatJid, {
    type: 'worddeduction',
    game: wordDeductionGame,
    starterJid,
    socket,
    data: {
      wordLength: WORD_DEDUCTION_WORD_LENGTH,
      maxAttempts,
      idleMs: delay,
      attempts: 0,
      guessed: new Set(),
      guesses: [],
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
      compactFrame('WORD DEDUCTION — TIMED OUT', [
        'Nobody answered in time.',
        `The word was ${secret.toUpperCase()}.`,
      ]),
    );
  });
}

export function quitWordDeduction(session, senderJid = null) {
  if (!session || session.ended || session.type !== 'worddeduction') return null;
  const secret = session.data.answer;
  session.clearTimer(IDLE_TIMER);
  session.api.end();
  const who = senderJid ? displayMention(senderJid) : 'Someone';
  return {
    kind: 'quit',
    text: compactFrame('WORD DEDUCTION — QUIT', [
      `${who} ended the game.`,
      `The word was ${secret.toUpperCase()}.`,
    ]),
    mentions: senderJid ? [senderJid] : [],
  };
}

/**
 * Applies one guess. Fully synchronous so two guesses arriving together
 * cannot both win or both consume the last attempt.
 *
 * Returns null when the session is gone or the value is not a five-letter
 * word; otherwise `{ kind, text, mentions }` where kind is one of
 * 'duplicate' | 'miss' | 'win' | 'loss'.
 */
export function processWordDeduction(session, value, senderJid = null) {
  if (!session || session.ended || session.type !== 'worddeduction') return null;
  const word = normalizeWordDeduction(value);
  if (!isFiveLetterWord(word)) return null;

  const { data } = session;
  if (data.guessed.has(word)) {
    return {
      kind: 'duplicate',
      text: compactFrame('WORD DEDUCTION — ALREADY TRIED', [
        `${word.toUpperCase()} was already guessed.`,
        attemptsLine(data),
      ]),
      mentions: [],
    };
  }

  const marks = scoreGuess(data.answer, word);
  data.guessed.add(word);
  data.guesses.push({ word, marks });
  data.attempts += 1;

  const mentions = senderJid ? [senderJid] : [];
  const who = senderJid ? displayMention(senderJid) : 'Someone';
  const board = historyLines(data);

  if (word === data.answer) {
    session.clearTimer(IDLE_TIMER);
    session.api.end();
    return {
      kind: 'win',
      text: compactFrame('WORD DEDUCTION — SOLVED', [
        `${who} found the word: ${data.answer.toUpperCase()}.`,
        ...board,
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
      text: compactFrame('WORD DEDUCTION — FAILED', [
        `${word.toUpperCase()} was wrong and the attempts are spent.`,
        ...board,
        `The word was ${data.answer.toUpperCase()}.`,
      ]),
      mentions: [],
    };
  }

  armIdleTimer(session);
  return {
    kind: 'miss',
    text: compactFrame('WORD DEDUCTION', [
      `${word.toUpperCase()} ${formatMarks(marks)}`,
      ...board,
      attemptsLine(data),
    ]),
    mentions: [],
  };
}

export const wordDeductionGame = {
  async onText(session, input, api) {
    const word = parseWordDeduction(input?.text);
    if (word === null) return;
    const outcome = processWordDeduction(session, word, input?.senderJid || null);
    if (!outcome) return;
    await api.send({ text: outcome.text, ...(outcome.mentions.length ? { mentions: outcome.mentions } : {}) });
  },
};
