import { compactFrame } from '../formatter.js';
import { CommandError, displayMention, normalizeJid } from '../helpers.js';
import { canonicalUserJid, participantAliases, sameUser } from '../identity.js';

export const WORD_CHAIN_TURN_MS = 60_000;
export const WORDCHAIN_TURN_MS = WORD_CHAIN_TURN_MS;
export const WORD_CHAIN_MIN_LENGTH = 3;
export const WORD_CHAIN_MAX_LENGTH = 32;

const TURN_TIMER = 'turn';
const JOIN_PATTERN = /^join$/i;
const WORD_PATTERN = new RegExp(`^\\s*([a-zA-Z]{${WORD_CHAIN_MIN_LENGTH},${WORD_CHAIN_MAX_LENGTH}})\\s*$`);

export function parseWord(text) {
  if (typeof text !== 'string') return null;
  const match = text.match(WORD_PATTERN);
  return match ? match[1] : null;
}

export function normalizeWord(word) {
  return typeof word === 'string' ? word.toLowerCase() : '';
}

export function lastLetter(word) {
  const normalized = normalizeWord(word);
  return normalized ? normalized[normalized.length - 1] : '';
}

export function startsWithLetter(word, letter) {
  const normalized = normalizeWord(word);
  const expected = typeof letter === 'string' ? letter.toLowerCase() : '';
  return Boolean(normalized && expected && normalized[0] === expected);
}

function canonicalPlayerJid(jid, groupMeta) {
  const normalized = normalizeJid(jid);
  if (!normalized) return null;
  return canonicalUserJid(groupMeta, normalized) || normalized;
}

function isSamePlayer(a, b, groupMeta) {
  if (!a || !b) return false;
  if (normalizeJid(a) === normalizeJid(b)) return true;
  return sameUser(groupMeta, a, b);
}

function knownAliases(jid, groupMeta) {
  const normalized = normalizeJid(jid);
  if (!normalized) return [];
  const canonical = canonicalUserJid(groupMeta, normalized);
  const aliases = new Set([normalized]);
  if (canonical) aliases.add(canonical);
  for (const participant of groupMeta?.participants || []) {
    const participantId = normalizeJid(participant.id);
    const participantJids = participantAliases(participant);
    if (
      participantId === normalized ||
      participantId === canonical ||
      participantJids.includes(normalized) ||
      participantJids.includes(canonical)
    ) {
      if (participantId) aliases.add(participantId);
      for (const alias of participantJids) aliases.add(alias);
    }
  }
  return [...aliases];
}

function matchesPlayer(storedJid, aliases, candidate, groupMeta) {
  if (!storedJid || !candidate) return false;
  if (normalizeJid(storedJid) === normalizeJid(candidate)) return true;
  if (Array.isArray(aliases) && aliases.includes(normalizeJid(candidate))) return true;
  return sameUser(groupMeta, storedJid, candidate);
}

function makePlayer(jid, groupMeta) {
  return { jid, aliases: knownAliases(jid, groupMeta) };
}

function playerIndex(players, jid, groupMeta) {
  if (!jid || !Array.isArray(players)) return -1;
  return players.findIndex((player) => matchesPlayer(player.jid, player.aliases, jid, groupMeta));
}

function currentPlayer(data) {
  if (!data?.players?.length) return null;
  return data.players[data.turnIndex] || null;
}

function playerLabel(player) {
  return player?.jid ? displayMention(player.jid) : 'an open seat';
}

function mentionsFor(...jids) {
  return jids.filter(Boolean);
}

function usedWords(data) {
  if (data.used instanceof Set) return data.used;
  data.used = new Set(Array.isArray(data.used) ? data.used : []);
  return data.used;
}

function chainPreview(data, limit = 8) {
  const chain = Array.isArray(data.chain) ? data.chain : [];
  if (!chain.length) return 'CHAIN: (empty — any valid word may start)';
  const shown = chain.length > limit ? chain.slice(-limit) : chain;
  const prefix = chain.length > limit ? '… → ' : '';
  return `CHAIN: ${prefix}${shown.join(' → ')}`;
}

function neededLetterLine(data) {
  if (!data.lastLetter) return `Start with any ${WORD_CHAIN_MIN_LENGTH}–${WORD_CHAIN_MAX_LENGTH} letter word.`;
  return `Next word must start with "${data.lastLetter.toUpperCase()}".`;
}

function turnLine(data) {
  const player = currentPlayer(data);
  return `TURN: ${playerLabel(player)}`;
}

function playersLine(data) {
  const names = (data.players || []).map((player) => displayMention(player.jid));
  return names.length ? `PLAYERS: ${names.join(', ')}` : 'PLAYERS: none';
}

function finish(session) {
  session.clearTimer?.(TURN_TIMER);
  if (typeof session.api?.end === 'function') session.api.end();
  else session.ended = true;
}

function armTurnTimer(session) {
  if (!session?.data || typeof session.setTimer !== 'function') return false;
  const delay = session.data.turnTimeoutMs;
  if (!Number.isFinite(delay) || delay < 0) return false;
  return session.setTimer(TURN_TIMER, delay, async (current, api) => {
    if (current.ended) return;
    const outcome = eliminateCurrentPlayer(current, 'timeout');
    if (!outcome) return;
    await api.send({
      text: outcome.text,
      ...(outcome.mentions.length ? { mentions: outcome.mentions } : {}),
    });
  });
}

function uniquePlayerJids(jids, groupMeta) {
  const players = [];
  for (const raw of jids) {
    const jid = canonicalPlayerJid(raw, groupMeta);
    if (!jid) continue;
    if (playerIndex(players, jid, groupMeta) !== -1) continue;
    players.push(makePlayer(jid, groupMeta));
  }
  return players;
}

function eliminateCurrentPlayer(session, reason) {
  const { data } = session;
  const player = currentPlayer(data);
  if (!player) {
    finish(session);
    return {
      kind: 'cancel',
      text: compactFrame('WORD CHAIN — CANCELLED', ['No player remains, so the session is closed.']),
      mentions: [],
    };
  }

  const jid = player.jid;
  data.players.splice(data.turnIndex, 1);
  if (data.turnIndex >= data.players.length) data.turnIndex = 0;

  if (data.players.length === 0) {
    finish(session);
    return {
      kind: 'cancel',
      text: compactFrame('WORD CHAIN — CANCELLED', [
        `${displayMention(jid)} ${reason === 'leave' ? 'left the game' : 'did not play in time'}. ${reason === 'leave' ? 'Fine.' : 'I do not wait.'}`,
        'No player remains, so the session is closed.',
      ]),
      mentions: mentionsFor(jid),
    };
  }

  if (data.players.length === 1) {
    const winner = data.players[0];
    if (data.lastWord) {
      finish(session);
      return {
        kind: 'win',
        text: compactFrame('WORD CHAIN — VICTORY', [
          `${displayMention(jid)} ${reason === 'leave' ? 'left the game. Flee, then.' : 'did not play in time. I do not wait.'}`,
          `${displayMention(winner.jid)} wins.`,
          chainPreview(data),
        ]),
        mentions: mentionsFor(jid, winner.jid),
      };
    }
    finish(session);
    return {
      kind: 'cancel',
      text: compactFrame('WORD CHAIN — CANCELLED', [
        `${displayMention(jid)} ${reason === 'leave' ? 'left the game. Fine.' : 'did not play in time. I do not wait.'}`,
        'No opponent remains, so the session is closed.',
      ]),
      mentions: mentionsFor(jid),
    };
  }

  const next = currentPlayer(data);
  armTurnTimer(session);
  const title = reason === 'leave' ? 'WORD CHAIN — FORFEIT' : 'WORD CHAIN — TIMED OUT';
  return {
    kind: reason === 'leave' ? 'forfeit' : 'timeout',
    text: compactFrame(title, [
      `${displayMention(jid)} ${reason === 'leave' ? 'left the game' : 'did not play in time'} and is out. ${reason === 'leave' ? 'Flee, then.' : 'Hesitation is death.'}`,
      playersLine(data),
      chainPreview(data),
      neededLetterLine(data),
      turnLine(data),
    ]),
    mentions: mentionsFor(jid, next?.jid),
  };
}

export function describeWordChainStart(session) {
  const { data } = session;
  return compactFrame('WORD CHAIN', [
    'Each word must start with the last letter of the previous word.',
    `Words are ${WORD_CHAIN_MIN_LENGTH}–${WORD_CHAIN_MAX_LENGTH} letters, A–Z only, and cannot be reused.`,
    'Reply with a single word on your turn. Other players join by replying with join.',
    playersLine(data),
    neededLetterLine(data),
    turnLine(data),
  ]);
}

export const describeWordchainStart = describeWordChainStart;

export function describeWordChainStatus(session) {
  const { data } = session;
  return compactFrame('WORD CHAIN — IN PROGRESS', [
    playersLine(data),
    chainPreview(data),
    neededLetterLine(data),
    turnLine(data),
  ]);
}

export const describeWordchainStatus = describeWordChainStatus;

export function startWordChain(games, chatJid, {
  starterJid = null,
  playerJids = [],
  socket = null,
  groupMeta = null,
  turnTimeoutMs = WORD_CHAIN_TURN_MS,
  timeoutMs = null,
} = {}) {
  if (!games || typeof games.start !== 'function') {
    throw new TypeError('A game manager is required.');
  }

  const delay = timeoutMs ?? turnTimeoutMs;
  if (!Number.isFinite(delay) || delay < 0) {
    throw new TypeError('A word-chain turn timeout must be a finite, non-negative number of milliseconds.');
  }

  const starter = canonicalPlayerJid(starterJid, groupMeta);
  const extras = Array.isArray(playerJids) ? playerJids : [];
  const players = uniquePlayerJids([starter, ...extras], groupMeta);
  if (!players.length) {
    throw new CommandError('A word-chain game needs at least one player.');
  }

  const session = games.start(chatJid, {
    type: 'wordchain',
    game: wordChainGame,
    starterJid: starter || starterJid,
    socket,
    data: {
      players,
      turnIndex: 0,
      used: new Set(),
      chain: [],
      lastWord: null,
      lastLetter: null,
      turnTimeoutMs: delay,
      minLength: WORD_CHAIN_MIN_LENGTH,
      maxLength: WORD_CHAIN_MAX_LENGTH,
    },
  });
  armTurnTimer(session);
  return session;
}

export const startWordchain = startWordChain;

export function joinWordChain(session, senderJid, { groupMeta = null } = {}) {
  if (!session || session.ended || session.type !== 'wordchain') return null;
  const { data } = session;
  if (!data || !Array.isArray(data.players)) return null;

  const jid = canonicalPlayerJid(senderJid, groupMeta);
  if (!jid) return null;
  if (playerIndex(data.players, jid, groupMeta) !== -1) return null;

  data.players.push(makePlayer(jid, groupMeta));
  return {
    kind: 'join',
    text: compactFrame('WORD CHAIN — JOINED', [
      `${displayMention(jid)} joined the chain.`,
      playersLine(data),
      chainPreview(data),
      neededLetterLine(data),
      turnLine(data),
    ]),
    mentions: mentionsFor(jid, currentPlayer(data)?.jid),
  };
}

export const joinWordchain = joinWordChain;

export function processWord(session, value, senderJid = null, { groupMeta = null } = {}) {
  if (!session || session.ended || session.type !== 'wordchain') return null;
  const { data } = session;
  if (!data || !Array.isArray(data.players)) return null;

  const chosen = parseWord(typeof value === 'string' ? value : '');
  if (!chosen) return null;

  const jid = canonicalPlayerJid(senderJid, groupMeta);
  if (senderJid && !jid) return null;

  const index = jid ? playerIndex(data.players, jid, groupMeta) : data.turnIndex;
  if (jid && index === -1) return null;
  if (!jid && data.players.length !== 1) return null;

  const player = data.players[index] || currentPlayer(data);
  if (!player) return null;

  if (index !== data.turnIndex) {
    const current = currentPlayer(data);
    return {
      kind: 'not-your-turn',
      text: compactFrame('WORD CHAIN — NOT YOUR TURN', [
        `It is ${playerLabel(current)}'s turn. Know your place.`,
        neededLetterLine(data),
      ]),
      mentions: mentionsFor(current?.jid),
    };
  }

  const normalized = normalizeWord(chosen);
  if (data.lastLetter && !startsWithLetter(normalized, data.lastLetter)) {
    return {
      kind: 'mismatch',
      text: compactFrame('WORD CHAIN — INVALID', [
        `"${chosen}" does not start with "${data.lastLetter.toUpperCase()}". Read the chain.`,
        neededLetterLine(data),
        turnLine(data),
      ]),
      mentions: mentionsFor(player.jid),
    };
  }

  const used = usedWords(data);
  if (used.has(normalized)) {
    return {
      kind: 'duplicate',
      text: compactFrame('WORD CHAIN — USED', [
        `"${chosen}" has already been used. Pay attention.`,
        neededLetterLine(data),
        turnLine(data),
      ]),
      mentions: mentionsFor(player.jid),
    };
  }

  used.add(normalized);
  data.chain.push(chosen.toLowerCase());
  data.lastWord = normalized;
  data.lastLetter = lastLetter(normalized);
  if (data.players.length > 1) {
    data.turnIndex = (data.turnIndex + 1) % data.players.length;
  }
  const next = currentPlayer(data);
  armTurnTimer(session);

  return {
    kind: 'word',
    text: compactFrame('WORD CHAIN', [
      `${displayMention(player.jid)} played "${normalized}".`,
      chainPreview(data),
      neededLetterLine(data),
      turnLine(data),
    ]),
    mentions: mentionsFor(player.jid, next?.jid && next.jid !== player.jid ? next.jid : null),
  };
}

export const processWordChainWord = processWord;
export const processWordchainWord = processWord;

export const wordChainGame = {
  async onText(session, input, api) {
    if (!session || session.ended || session.type !== 'wordchain') return;
    const text = input?.text;
    if (typeof text !== 'string') return;
    const senderJid = input?.senderJid || null;
    const groupMeta = input?.groupMeta || null;
    const trimmed = text.trim();

    if (JOIN_PATTERN.test(trimmed)) {
      const outcome = joinWordChain(session, senderJid, { groupMeta });
      if (outcome) await api.send({ text: outcome.text, mentions: outcome.mentions });
      return;
    }

    const word = parseWord(text);
    if (word === null) return;
    const outcome = processWord(session, word, senderJid, { groupMeta });
    if (!outcome) return;
    await api.send({
      text: outcome.text,
      ...(outcome.mentions.length ? { mentions: outcome.mentions } : {}),
    });
  },

  async onPlayerLeave(session, leavingJid, api, input = {}) {
    if (!session || session.ended || session.type !== 'wordchain') return;
    const { data } = session;
    const groupMeta = input?.groupMeta || null;
    const jid = canonicalPlayerJid(leavingJid, groupMeta);
    if (!jid) return;

    const index = playerIndex(data.players, jid, groupMeta);
    if (index === -1) return;

    const wasTurn = index === data.turnIndex;
    if (wasTurn) {
      const outcome = eliminateCurrentPlayer(session, 'leave');
      if (outcome) {
        await api.send({
          text: outcome.text,
          ...(outcome.mentions.length ? { mentions: outcome.mentions } : {}),
        });
      }
      return;
    }

    if (index < data.turnIndex) data.turnIndex -= 1;
    data.players.splice(index, 1);

    if (data.players.length === 0) {
      finish(session);
      await api.send({
        text: compactFrame('WORD CHAIN — CANCELLED', [
          `${displayMention(jid)} left the game. Fine.`,
          'No player remains, so the session is closed.',
        ]),
        mentions: [jid],
      });
      return;
    }

    if (data.players.length === 1) {
      const remaining = data.players[0];
      if (data.lastWord) {
        finish(session);
        await api.send({
          text: compactFrame('WORD CHAIN — VICTORY', [
            `${displayMention(jid)} left the game. Flee, then.`,
            `${displayMention(remaining.jid)} wins.`,
            chainPreview(data),
          ]),
          mentions: mentionsFor(jid, remaining.jid),
        });
        return;
      }
      finish(session);
      await api.send({
        text: compactFrame('WORD CHAIN — CANCELLED', [
          `${displayMention(jid)} left the game. Fine.`,
          'No opponent remains, so the session is closed.',
        ]),
        mentions: mentionsFor(jid),
      });
      return;
    }

    await api.send({
      text: compactFrame('WORD CHAIN — FORFEIT', [
        `${displayMention(jid)} left the game. Flee, then.`,
        playersLine(data),
        chainPreview(data),
        neededLetterLine(data),
        turnLine(data),
      ]),
      mentions: mentionsFor(jid, currentPlayer(data)?.jid),
    });
  },
};

export const wordchainGame = wordChainGame;
