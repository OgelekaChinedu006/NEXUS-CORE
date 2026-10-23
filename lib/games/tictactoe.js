import { compactFrame } from '../formatter.js';
import { CommandError, displayMention, normalizeJid } from '../helpers.js';
import { canonicalUserJid, participantAliases, sameUser } from '../identity.js';

export const TIC_TAC_TOE_TURN_MS = 60_000;
export const TICTACTOE_TURN_MS = TIC_TAC_TOE_TURN_MS;
export const TIC_TAC_TOE_BOARD_SIZE = 9;
export const TIC_TAC_TOE_SYMBOLS = Object.freeze(['X', 'O']);
export const WIN_LINES = Object.freeze([
  Object.freeze([0, 1, 2]),
  Object.freeze([3, 4, 5]),
  Object.freeze([6, 7, 8]),
  Object.freeze([0, 3, 6]),
  Object.freeze([1, 4, 7]),
  Object.freeze([2, 5, 8]),
  Object.freeze([0, 4, 8]),
  Object.freeze([2, 4, 6]),
]);
export const TIC_TAC_TOE_WIN_LINES = WIN_LINES;

const TURN_TIMER = 'turn';
const CELL_PATTERN = /^\s*([1-9])\s*$/;
const JOIN_PATTERN = /^join$/i;
const SURRENDER_PATTERN = /^surrender$/i;

export function createBoard() {
  return Array.from({ length: TIC_TAC_TOE_BOARD_SIZE }, () => null);
}

export const createTicTacToeBoard = createBoard;

/** Parses a human-facing cell number (1-9). Returns null for anything else. */
export function parseMove(text) {
  if (typeof text !== 'string') return null;
  const match = text.match(CELL_PATTERN);
  return match ? Number(match[1]) : null;
}

function toCellNumber(value) {
  if (typeof value === 'string') return parseMove(value);
  if (!Number.isInteger(value) || value < 1 || value > TIC_TAC_TOE_BOARD_SIZE) return null;
  return value;
}

/** Returns 'X', 'O' or null. */
export function findWinner(board) {
  for (const line of WIN_LINES) {
    const [a, b, c] = line;
    const symbol = board?.[a];
    if (symbol && symbol === board[b] && symbol === board[c]) return symbol;
  }
  return null;
}

export const getWinner = findWinner;
export const checkWinner = findWinner;

export function getWinningLine(board) {
  for (const line of WIN_LINES) {
    const [a, b, c] = line;
    const symbol = board?.[a];
    if (symbol && symbol === board[b] && symbol === board[c]) return line;
  }
  return null;
}

export function isBoardFull(board) {
  return Array.isArray(board) && board.length === TIC_TAC_TOE_BOARD_SIZE && board.every(Boolean);
}

export function isDraw(board) {
  return isBoardFull(board) && !findWinner(board);
}

const EMPTY_CELL_LABELS = Object.freeze(['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣']);
const SYMBOL_LABELS = Object.freeze({ X: '❌', O: '⭕' });

/** Renders the board as three rows; empty cells keep emoji 1-9 labels. */
export function renderBoard(board) {
  const cells = Array.isArray(board) ? board : createBoard();
  const value = (index) => {
    const symbol = cells[index];
    if (symbol && SYMBOL_LABELS[symbol]) return SYMBOL_LABELS[symbol];
    return EMPTY_CELL_LABELS[index];
  };
  return [
    `${value(0)} | ${value(1)} | ${value(2)}`,
    '---------',
    `${value(3)} | ${value(4)} | ${value(5)}`,
    '---------',
    `${value(6)} | ${value(7)} | ${value(8)}`,
  ].join('\n');
}

const BOARD_PLACEHOLDER = '\u0000NEXUS_TTT_BOARD\u0000';

function compactFrameWithBoard(title, before, board, after = []) {
  return compactFrame(title, [...before, BOARD_PLACEHOLDER, ...after])
    .replace(`▸ ${BOARD_PLACEHOLDER}`, renderBoard(board));
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

// Keeps the aliases known at start time: a participant may already be gone
// from group metadata by the time their departure event reaches the game.
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

function playerFor(session, jid, groupMeta) {
  if (!jid || !session?.data) return null;
  const { data } = session;
  if (matchesPlayer(data.xJid, data.xAliases, jid, groupMeta)) return 'X';
  if (matchesPlayer(data.oJid, data.oAliases, jid, groupMeta)) return 'O';
  return null;
}

function setPlayer(data, symbol, jid, groupMeta) {
  const aliases = knownAliases(jid, groupMeta);
  if (symbol === 'X') {
    data.xJid = jid;
    data.xAliases = aliases;
  } else {
    data.oJid = jid;
    data.oAliases = aliases;
  }
}

function playerJid(data, symbol) {
  if (!data) return null;
  return symbol === 'X' ? data.xJid || null : data.oJid || null;
}

function playerLabel(data, symbol) {
  const jid = playerJid(data, symbol);
  return jid ? displayMention(jid) : 'an open seat';
}

function mentionsFor(...jids) {
  return jids.filter(Boolean);
}

function turnLine(data) {
  if (data.winner) return `WINNER: ${data.winner} — ${playerLabel(data, data.winner)}`;
  if (data.draw) return 'DRAW: the board is full.';
  return `TURN: ${data.turn} — ${playerLabel(data, data.turn)}`;
}

function finish(session) {
  if (!session || session.ended) return false;
  session.clearTimer?.(TURN_TIMER);
  if (typeof session.api?.end === 'function') session.api.end();
  else session.ended = true;
  return true;
}

function isInitiator(session, jid, groupMeta) {
  if (!jid || !session) return false;
  if (isSamePlayer(session.starterJid, jid, groupMeta)) return true;
  const { data } = session;
  if (!data) return false;
  return matchesPlayer(data.xJid, data.xAliases, jid, groupMeta);
}

function opponentOf(symbol) {
  return symbol === 'X' ? 'O' : 'X';
}

function cancelOutcome(jid) {
  return {
    kind: 'cancel',
    text: compactFrame('TIC TAC TOE — CANCELLED', [
      `${displayMention(jid)} left the game. Fine.`,
      'No opponent remains, so the session is closed.',
    ]),
    mentions: mentionsFor(jid),
  };
}

function forfeitOutcome(jid, otherJid) {
  return {
    kind: 'forfeit',
    text: compactFrame('TIC TAC TOE — FORFEIT', [
      `${displayMention(jid)} left the game. Flee, then.`,
      `${displayMention(otherJid)} wins by forfeit.`,
    ]),
    mentions: mentionsFor(jid, otherJid),
  };
}

function endByDeparture(session, jid, symbol) {
  if (!finish(session)) return null;
  const otherJid = playerJid(session.data, opponentOf(symbol));
  return otherJid ? forfeitOutcome(jid, otherJid) : cancelOutcome(jid);
}

function armTurnTimer(session) {
  if (!session?.data || typeof session.setTimer !== 'function') return false;
  const delay = session.data.turnTimeoutMs;
  if (!Number.isFinite(delay) || delay < 0) return false;
  return session.setTimer(TURN_TIMER, delay, async (current, api) => {
    if (current.ended || current.data.winner || current.data.draw) return;
    const symbol = current.data.turn;
    const jid = playerJid(current.data, symbol);
    finish(current);
    await api.send({
      text: compactFrameWithBoard(
        'TIC TAC TOE — TIMED OUT',
        [`${jid ? displayMention(jid) : symbol} did not move in time. I do not wait.`],
        current.data.board,
        ['The session has been closed.'],
      ),
      ...(jid ? { mentions: [jid] } : {}),
    });
  });
}

export function describeTicTacToeStart(session) {
  const { data } = session;
  const lines = [];
  if (data.xJid) lines.push(`${displayMention(data.xJid)} is X.`);
  else lines.push('The first player to move will be X.');
  if (data.oJid) lines.push(`${displayMention(data.oJid)} is O.`);
  else lines.push('An opponent joins by replying with a cell number.');
  return compactFrameWithBoard(
    'TIC TAC TOE',
    lines,
    data.board,
    ['X moves first. Reply with a cell number from 1 to 9.', turnLine(data)],
  );
}

export const describeTictactoeStart = describeTicTacToeStart;

export function describeTicTacToeStatus(session) {
  const { data } = session;
  return compactFrameWithBoard(
    'TIC TAC TOE — IN PROGRESS',
    [],
    data.board,
    [`X: ${playerLabel(data, 'X')}`, `O: ${playerLabel(data, 'O')}`, turnLine(data)],
  );
}

export const describeTictactoeStatus = describeTicTacToeStatus;

/**
 * Starts a two-player board through the shared manager. `opponentJid` is
 * optional: without it the game starts with only X and the first other player
 * to move after X joins as O. Throws the manager's CommandError when a game is
 * already running in the chat.
 */
export function startTicTacToe(games, chatJid, {
  starterJid = null,
  opponentJid = null,
  targetJid = null,
  socket = null,
  groupMeta = null,
  turnTimeoutMs = TIC_TAC_TOE_TURN_MS,
  timeoutMs = null,
} = {}) {
  if (!games || typeof games.start !== 'function') {
    throw new TypeError('A game manager is required.');
  }

  const xJid = canonicalPlayerJid(starterJid, groupMeta);
  const oJid = canonicalPlayerJid(opponentJid ?? targetJid, groupMeta);
  if (xJid && oJid && isSamePlayer(xJid, oJid, groupMeta)) {
    throw new CommandError('You cannot challenge yourself to tic-tac-toe.');
  }

  const delay = timeoutMs ?? turnTimeoutMs;
  if (!Number.isFinite(delay) || delay < 0) {
    throw new TypeError('A tic-tac-toe turn timeout must be a finite, non-negative number of milliseconds.');
  }

  const session = games.start(chatJid, {
    type: 'tictactoe',
    game: tictactoeGame,
    starterJid: xJid || starterJid,
    socket,
    data: {
      board: createBoard(),
      xJid,
      xAliases: knownAliases(xJid, groupMeta),
      oJid,
      oAliases: knownAliases(oJid, groupMeta),
      turn: 'X',
      moves: 0,
      winner: null,
      winningLine: null,
      draw: false,
      turnTimeoutMs: delay,
    },
  });
  armTurnTimer(session);
  return session;
}

export const startTictactoe = startTicTacToe;
export const startTTT = startTicTacToe;

/**
 * Adds the second player to an open game. Returns null when the session is not
 * an open tic-tac-toe game or the sender is already the starter.
 */
export function joinTicTacToe(session, senderJid, { groupMeta = null } = {}) {
  if (!session || session.ended || session.type !== 'tictactoe') return null;
  const { data } = session;
  if (!data || data.oJid || !data.xJid || data.winner || data.draw) return null;

  const jid = canonicalPlayerJid(senderJid, groupMeta);
  if (!jid || isSamePlayer(data.xJid, jid, groupMeta)) return null;

  setPlayer(data, 'O', jid, groupMeta);
  armTurnTimer(session);
  return {
    kind: 'join',
    text: compactFrameWithBoard(
      'TIC TAC TOE — OPPONENT JOINED',
      [`${displayMention(jid)} joined as O.`],
      data.board,
      [turnLine(data)],
    ),
    mentions: mentionsFor(jid),
  };
}

export const joinTictactoe = joinTicTacToe;

/**
 * Lets a seated player surrender. The opponent wins by forfeit when both
 * seats are filled; an open game is cancelled. Returns null when the sender
 * is not a seated player or the session is already over.
 */
export function surrenderTicTacToe(session, senderJid, { groupMeta = null } = {}) {
  if (!session || session.ended || session.type !== 'tictactoe') return null;
  const { data } = session;
  if (!data || data.winner || data.draw) return null;

  const jid = canonicalPlayerJid(senderJid, groupMeta);
  if (!jid) return null;
  const symbol = playerFor(session, jid, groupMeta);
  if (!symbol) return null;
  return endByDeparture(session, jid, symbol);
}

export const surrenderTictactoe = surrenderTicTacToe;

/**
 * Lets the original initiator exit. If an opponent has joined they win by
 * forfeit; otherwise the game is cancelled. Returns null when the sender is
 * not the initiator. Throws CommandError when a non-initiator tries to exit.
 */
export function exitTicTacToe(session, senderJid, { groupMeta = null } = {}) {
  if (!session || session.ended || session.type !== 'tictactoe') return null;
  const { data } = session;
  if (!data || data.winner || data.draw) return null;

  const jid = canonicalPlayerJid(senderJid, groupMeta);
  if (!jid) return null;
  if (!isInitiator(session, jid, groupMeta)) {
    throw new CommandError('Only the player who started this game may exit it.');
  }
  const symbol = playerFor(session, jid, groupMeta) || 'X';
  return endByDeparture(session, jid, symbol);
}

export const exitTictactoe = exitTicTacToe;

/**
 * Applies one move. Fully synchronous, so concurrent messages cannot both
 * claim the same turn or cell. Returns null when the message should be ignored
 * (ended/foreign session, invalid cell, spectator). Otherwise returns
 * `{ kind, text, mentions }` with kind 'move' | 'win' | 'draw' |
 * 'not-your-turn' | 'occupied'.
 */
export function processMove(session, value, senderJid = null, { groupMeta = null } = {}) {
  if (!session || session.ended || session.type !== 'tictactoe') return null;
  const { data } = session;
  if (!data || !Array.isArray(data.board)) return null;

  const cell = toCellNumber(value);
  if (cell === null) return null;
  const index = cell - 1;

  const jid = canonicalPlayerJid(senderJid, groupMeta);
  if (senderJid && !jid) return null;

  let symbol = jid ? playerFor(session, jid, groupMeta) : null;
  let joined = false;
  if (!symbol) {
    if (!jid) {
      symbol = data.turn;
    } else if (!data.xJid) {
      setPlayer(data, 'X', jid, groupMeta);
      symbol = 'X';
      joined = true;
    } else if (!data.oJid && data.turn === 'O' && !isSamePlayer(data.xJid, jid, groupMeta)) {
      setPlayer(data, 'O', jid, groupMeta);
      symbol = 'O';
      joined = true;
    } else {
      return null;
    }
  }

  if (symbol !== data.turn) {
    const currentJid = playerJid(data, data.turn);
    return {
      kind: 'not-your-turn',
      text: compactFrameWithBoard(
        'TIC TAC TOE — NOT YOUR TURN',
        [`It is ${data.turn}'s turn${currentJid ? ` (${displayMention(currentJid)})` : ''}. Know your place.`],
        data.board,
      ),
      mentions: mentionsFor(currentJid),
    };
  }

  if (data.board[index]) {
    return {
      kind: 'occupied',
      text: compactFrameWithBoard(
        'TIC TAC TOE — CELL TAKEN',
        [`Cell ${cell} is already occupied. Pay attention.`],
        data.board,
      ),
      mentions: mentionsFor(jid),
    };
  }

  data.board[index] = symbol;
  data.moves = (data.moves || 0) + 1;
  const who = jid ? displayMention(jid) : `Player ${symbol}`;
  const winningLine = getWinningLine(data.board);

  if (winningLine) {
    data.winner = symbol;
    data.winningLine = winningLine;
    finish(session);
    return {
      kind: 'win',
      winner: symbol,
      text: compactFrameWithBoard(
        'TIC TAC TOE — VICTORY',
        [`${who} placed ${symbol} in cell ${cell}.`],
        data.board,
        [`${symbol} wins. Acceptable.`],
      ),
      mentions: mentionsFor(jid),
    };
  }

  if (isBoardFull(data.board)) {
    data.draw = true;
    finish(session);
    return {
      kind: 'draw',
      text: compactFrameWithBoard(
        'TIC TAC TOE — DRAW',
        [`${who} placed ${symbol} in cell ${cell}.`],
        data.board,
        ['The board is full. Neither side wins. How tedious.'],
      ),
      mentions: mentionsFor(jid),
    };
  }

  data.turn = symbol === 'X' ? 'O' : 'X';
  const nextJid = playerJid(data, data.turn);
  armTurnTimer(session);

  return {
    kind: 'move',
    text: compactFrameWithBoard(
      'TIC TAC TOE',
      [`${who} ${joined ? `joined as ${symbol} and ` : ''}placed ${symbol} in cell ${cell}.`],
      data.board,
      [
        nextJid
          ? `TURN: ${data.turn} — ${displayMention(nextJid)}`
          : 'Waiting for an opponent. Any other player can join by replying with a cell number.',
      ],
    ),
    mentions: mentionsFor(jid, nextJid),
  };
}

export const processTicTacToeMove = processMove;
export const processTictactoeMove = processMove;

/** Game object registered with the manager. */
export const tictactoeGame = {
  async onText(session, input, api) {
    if (!session || session.ended || session.type !== 'tictactoe') return;
    const text = input?.text;
    if (typeof text !== 'string') return;
    const senderJid = input?.senderJid || null;
    const groupMeta = input?.groupMeta || null;

    const trimmed = text.trim();
    if (JOIN_PATTERN.test(trimmed)) {
      const outcome = joinTicTacToe(session, senderJid, { groupMeta });
      if (outcome) await api.send({ text: outcome.text, mentions: outcome.mentions });
      return;
    }

    if (SURRENDER_PATTERN.test(trimmed)) {
      const outcome = surrenderTicTacToe(session, senderJid, { groupMeta });
      if (outcome) {
        await api.send({
          text: outcome.text,
          ...(outcome.mentions.length ? { mentions: outcome.mentions } : {}),
        });
      }
      return;
    }

    const cell = parseMove(text);
    if (cell === null) return;
    const outcome = processMove(session, cell, senderJid, { groupMeta });
    if (!outcome) return;
    await api.send({
      text: outcome.text,
      ...(outcome.mentions.length ? { mentions: outcome.mentions } : {}),
    });
  },

  async onPlayerLeave(session, leavingJid, api, input = {}) {
    if (!session || session.ended || session.type !== 'tictactoe') return;
    const groupMeta = input?.groupMeta || null;
    const jid = canonicalPlayerJid(leavingJid, groupMeta);
    if (!jid) return;

    const symbol = playerFor(session, jid, groupMeta);
    if (!symbol) return;

    const outcome = endByDeparture(session, jid, symbol);
    if (!outcome) return;
    await api.send({
      text: outcome.text,
      ...(outcome.mentions.length ? { mentions: outcome.mentions } : {}),
    });
  },
};

export const ticTacToeGame = tictactoeGame;
