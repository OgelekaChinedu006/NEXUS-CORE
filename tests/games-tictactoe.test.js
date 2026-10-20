import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createGameManager } from '../lib/games/manager.js';
import {
  TIC_TAC_TOE_TURN_MS,
  WIN_LINES,
  createBoard,
  describeTicTacToeStart,
  describeTicTacToeStatus,
  findWinner,
  getWinningLine,
  isDraw,
  joinTicTacToe,
  parseMove,
  processMove,
  renderBoard,
  startTicTacToe,
} from '../lib/games/tictactoe.js';
import { loadCommands } from '../lib/registry.js';
import { createLogger } from '../lib/logger.js';
import { CommandError } from '../lib/helpers.js';
import tictactoeCommand from '../commands/fun/tictactoe.js';

const ROOT = path.resolve(import.meta.dirname, '..');
const GROUP = '120363000000000000@g.us';
const OTHER_GROUP = '120363000000000001@g.us';
const MEMBER = '111@s.whatsapp.net';
const OTHER = '222@s.whatsapp.net';
const SPECTATOR = '333@s.whatsapp.net';
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

function setup({ opponentJid = OTHER, turnTimeoutMs, groupMeta = null, starterJid = MEMBER } = {}) {
  const socket = makeSocket();
  const games = createGameManager({ getSocket: () => socket, logger: silent });
  const session = startTicTacToe(games, GROUP, {
    starterJid,
    opponentJid,
    groupMeta,
    ...(turnTimeoutMs === undefined ? {} : { turnTimeoutMs }),
  });
  return { socket, games, session };
}

function say(games, text, { senderJid = MEMBER, groupMeta = null, chatJid = GROUP } = {}) {
  return games.handleText({ chatJid, senderJid, text, groupMeta, isGroup: true });
}

async function play(games, moves) {
  for (const [sender, cell] of moves) await say(games, String(cell), { senderJid: sender });
}

function makeCtx(games, overrides = {}) {
  const replies = [];
  return {
    replies,
    ctx: {
      games,
      sock: null,
      prefix: '!',
      args: [],
      argsText: '',
      chatJid: GROUP,
      isGroup: true,
      senderJid: MEMBER,
      targetJid: null,
      groupMeta: null,
      reply: async (text, options = {}) => {
        replies.push({ text, options });
      },
      ...overrides,
    },
  };
}

// ── board helpers ───────────────────────────────────────────────────────────

test('parseMove accepts only cell numbers 1 through 9', () => {
  for (let cell = 1; cell <= 9; cell += 1) assert.equal(parseMove(String(cell)), cell);
  assert.equal(parseMove(' 5 '), 5);
  for (const text of ['0', '10', '05', '-1', '3.5', '1 2', 'hello', '', '   ', null, undefined, 5]) {
    assert.equal(parseMove(text), null, String(text));
  }
});

test('createBoard starts empty and renderBoard labels every empty cell', () => {
  const board = createBoard();
  assert.equal(board.length, 9);
  assert.ok(board.every((cell) => cell === null));
  const rendered = renderBoard(board);
  assert.equal(
    rendered,
    ['1️⃣ | 2️⃣ | 3️⃣', '---------', '4️⃣ | 5️⃣ | 6️⃣', '---------', '7️⃣ | 8️⃣ | 9️⃣'].join('\n'),
  );
});

test('renderBoard maps emoji numbers to existing cell indices and shows player symbols', () => {
  const board = createBoard();
  board[0] = 'X';
  board[4] = 'O';
  board[8] = 'X';
  const rendered = renderBoard(board);
  const rows = rendered.split('\n').filter((line) => !line.startsWith('-'));
  assert.equal(rows[0], '❌ | 2️⃣ | 3️⃣');
  assert.equal(rows[1], '4️⃣ | ⭕ | 6️⃣');
  assert.equal(rows[2], '7️⃣ | 8️⃣ | ❌');
  assert.equal(board[0], 'X');
  assert.equal(board[4], 'O');
  assert.equal(board[8], 'X');
});

test('findWinner detects every row, column and diagonal', () => {
  assert.equal(WIN_LINES.length, 8);
  for (const line of WIN_LINES) {
    const board = createBoard();
    for (const index of line) board[index] = 'X';
    assert.equal(findWinner(board), 'X');
    assert.deepEqual(getWinningLine(board), line);
  }
  assert.equal(findWinner(createBoard()), null);
});

test('isDraw requires a full board with no winner', () => {
  const draw = ['X', 'O', 'X', 'X', 'O', 'O', 'O', 'X', 'X'];
  assert.equal(findWinner(draw), null);
  assert.equal(isDraw(draw), true);
  assert.equal(isDraw(['X', null, 'O']), false);

  const won = createBoard();
  won[0] = won[1] = won[2] = 'O';
  assert.equal(isDraw(won), false);
});

// ── starting and describing ─────────────────────────────────────────────────

test('startTicTacToe registers a two-player session with X to move and a turn timer', () => {
  const { games, session } = setup();
  assert.equal(session.type, 'tictactoe');
  assert.equal(session.starterJid, MEMBER);
  assert.equal(session.data.xJid, MEMBER);
  assert.equal(session.data.oJid, OTHER);
  assert.equal(session.data.turn, 'X');
  assert.equal(session.data.turnTimeoutMs, TIC_TAC_TOE_TURN_MS);
  assert.equal(session.data.moves, 0);
  assert.equal(games.get(GROUP), session);
  assert.equal(session.timers.has('turn'), true);
  games.shutdown();
});

test('startTicTacToe supports an open seat when no opponent is supplied', () => {
  const { games, session } = setup({ opponentJid: null });
  assert.equal(session.data.xJid, MEMBER);
  assert.equal(session.data.oJid, null);
  assert.match(describeTicTacToeStart(session), /opponent joins/i);
  games.shutdown();
});

test('startTicTacToe rejects self-challenges, existing games and invalid timeouts', () => {
  const games = createGameManager({ logger: silent });
  assert.throws(
    () => startTicTacToe(games, GROUP, { starterJid: MEMBER, opponentJid: MEMBER }),
    (error) => error instanceof CommandError && /challenge yourself/.test(error.message),
  );
  assert.equal(games.hasSession(GROUP), false);

  const running = startTicTacToe(games, GROUP, { starterJid: MEMBER, opponentJid: OTHER });
  assert.throws(
    () => startTicTacToe(games, GROUP, { starterJid: OTHER, opponentJid: SPECTATOR }),
    (error) => error instanceof CommandError && /already running/.test(error.message),
  );
  assert.equal(games.get(GROUP), running);
  games.shutdown();

  for (const turnTimeoutMs of [Number.NaN, -1, Infinity, '1000']) {
    assert.throws(
      () => startTicTacToe(games, GROUP, { starterJid: MEMBER, turnTimeoutMs }),
      TypeError,
      String(turnTimeoutMs),
    );
    assert.equal(games.hasSession(GROUP), false);
  }
});

test('start and status messages show the board, both players and whose turn it is', () => {
  const { session } = setup();
  const start = describeTicTacToeStart(session);
  assert.match(start, /TIC TAC TOE/);
  assert.match(start, /@111 is X/);
  assert.match(start, /@222 is O/);
  assert.match(start, /1 to 9/);
  assert.match(start, /TURN: X/);
  assert.match(start, /(?<!▸ )1️⃣ \| 2️⃣ \| 3️⃣\n---------\n4️⃣ \| 5️⃣ \| 6️⃣\n---------\n7️⃣ \| 8️⃣ \| 9️⃣/);

  processMove(session, 5, MEMBER);
  const status = describeTicTacToeStatus(session);
  assert.match(status, /IN PROGRESS/);
  assert.match(status, /TURN: O/);
  assert.match(status, /@222/);
  assert.match(status, /4️⃣ \| ❌ \| 6️⃣/);
});

test('the starter is recognised through LID and phone aliases', () => {
  const groupMeta = {
    participants: [{ id: '5@lid', phoneNumber: '2348012345678@s.whatsapp.net' }, { id: OTHER }],
  };
  const { games, session, socket } = setup({ starterJid: '5@lid', groupMeta });
  assert.equal(session.data.xJid, '5@lid');

  return say(games, '5', { senderJid: '2348012345678@s.whatsapp.net', groupMeta }).then(() => {
    assert.equal(session.data.board[4], 'X');
    assert.equal(socket.sent.length, 1);
  });
});

// ── moves and turn handling ─────────────────────────────────────────────────

test('players alternate, the board updates and the next player is mentioned', async () => {
  const { games, session, socket } = setup();
  await say(games, '5', { senderJid: MEMBER });
  assert.equal(session.data.board[4], 'X');
  assert.equal(session.data.turn, 'O');
  assert.match(socket.sent[0].content.text, /placed X in cell 5/);
  assert.match(socket.sent[0].content.text, /TURN: O — @222/);
  assert.deepEqual(socket.sent[0].content.mentions, [MEMBER, OTHER]);

  await say(games, '1', { senderJid: OTHER });
  assert.equal(session.data.board[0], 'O');
  assert.equal(session.data.turn, 'X');
  assert.equal(games.get(GROUP), session);
});

test('an out-of-turn player cannot move and a taken cell cannot be overwritten', async () => {
  const { games, session, socket } = setup();
  await say(games, '5', { senderJid: MEMBER });

  await say(games, '3', { senderJid: MEMBER });
  assert.match(socket.sent[1].content.text, /NOT YOUR TURN/);
  assert.equal(session.data.board[2], null);
  assert.equal(session.data.turn, 'O');

  await say(games, '5', { senderJid: OTHER });
  assert.match(socket.sent[2].content.text, /CELL TAKEN/);
  assert.equal(session.data.board[4], 'X');
  assert.equal(session.data.turn, 'O');
  assert.equal(games.get(GROUP), session);
});

test('spectators, chatter and out-of-range numbers are ignored', async () => {
  const { games, session, socket } = setup();
  for (const text of ['hello', '10', '0', '3.5', '5 2']) {
    await say(games, text, { senderJid: SPECTATOR });
  }
  await say(games, '2', { senderJid: SPECTATOR });
  assert.equal(socket.sent.length, 0);
  assert.equal(session.data.moves, 0);
  assert.equal(games.get(GROUP), session);
});

test('two simultaneous moves cannot both claim the board or the turn', async () => {
  const { games, session } = setup();
  await Promise.all([
    say(games, '5', { senderJid: MEMBER }),
    say(games, '5', { senderJid: OTHER }),
  ]);
  assert.equal(session.data.board[4], 'X');
  assert.equal(session.data.moves, 1);
  assert.equal(session.data.turn, 'O');
  assert.equal(games.get(GROUP), session);
});

test('an open game accepts the first other player as O after X moves', async () => {
  const { games, session } = setup({ opponentJid: null });
  await say(games, '5', { senderJid: MEMBER });
  assert.equal(session.data.oJid, null);
  assert.equal(session.data.turn, 'O');

  await say(games, '3', { senderJid: OTHER });
  assert.equal(session.data.oJid, OTHER);
  assert.equal(session.data.board[2], 'O');
  assert.equal(session.data.turn, 'X');

  await say(games, '1', { senderJid: SPECTATOR });
  assert.equal(session.data.board[0], null);
  assert.equal(session.data.oJid, OTHER);
  assert.equal(games.get(GROUP), session);
});

test('the explicit join keyword fills an open seat without consuming a turn', async () => {
  const { games, session, socket } = setup({ opponentJid: null });
  await say(games, '5', { senderJid: MEMBER });
  await say(games, 'join', { senderJid: OTHER });
  assert.equal(session.data.oJid, OTHER);
  assert.equal(session.data.turn, 'O');
  assert.match(socket.sent[1].content.text, /@222 joined as O/);

  await say(games, '3', { senderJid: OTHER });
  assert.equal(session.data.board[2], 'O');
  assert.equal(session.data.turn, 'X');
});

test('joinTicTacToe refuses a taken seat, the starter and foreign sessions', () => {
  const { session } = setup({ opponentJid: null });
  assert.equal(joinTicTacToe(session, MEMBER), null);
  assert.equal(joinTicTacToe(null, OTHER), null);
  assert.equal(joinTicTacToe({ type: 'guess', ended: false, data: {} }, OTHER), null);
  assert.equal(joinTicTacToe(session, OTHER).kind, 'join');
  assert.equal(joinTicTacToe(session, SPECTATOR), null);
});

// ── wins, draws, cleanup ────────────────────────────────────────────────────

test('three in a row wins, mentions the winner and frees the chat', async () => {
  const { games, socket } = setup();
  await play(games, [[MEMBER, 1], [OTHER, 4], [MEMBER, 2], [OTHER, 5], [MEMBER, 3]]);
  const win = socket.sent.at(-1);
  assert.match(win.content.text, /VICTORY/);
  assert.match(win.content.text, /X wins/);
  assert.deepEqual(win.content.mentions, [MEMBER]);
  assert.equal(games.hasSession(GROUP), false);
  assert.equal(await say(games, '9', { senderJid: OTHER }), false);
});

test('a full board without a line ends in a draw and frees the chat', async () => {
  const { games, socket } = setup();
  await play(games, [
    [MEMBER, 1], [OTHER, 2], [MEMBER, 3], [OTHER, 5], [MEMBER, 4],
    [OTHER, 6], [MEMBER, 8], [OTHER, 7], [MEMBER, 9],
  ]);
  const draw = socket.sent.at(-1);
  assert.match(draw.content.text, /DRAW/);
  assert.match(draw.content.text, /Neither side wins/);
  assert.equal(games.hasSession(GROUP), false);
});

test('processMove ignores ended, foreign and malformed sessions', () => {
  const { games, session } = setup();
  games.end(GROUP);
  assert.equal(processMove(session, 5, MEMBER), null);
  assert.equal(processMove(null, 5, MEMBER), null);
  assert.equal(processMove({ type: 'guess', ended: false, data: {} }, 5, MEMBER), null);
  assert.equal(processMove({ type: 'tictactoe', ended: false, data: { board: createBoard() } }, 0, MEMBER), null);
});

test('a game in one chat never accepts moves from another chat', async () => {
  const { games, session } = setup();
  assert.equal(await say(games, '5', { senderJid: MEMBER, chatJid: OTHER_GROUP }), false);
  assert.equal(session.data.board[4], null);
  assert.equal(games.get(GROUP), session);
});

// ── timeouts ────────────────────────────────────────────────────────────────

test('a turn timeout closes the session and clears the timer', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { games, socket } = setup({ turnTimeoutMs: 1000 });
  t.mock.timers.tick(999);
  assert.equal(games.hasSession(GROUP), true);
  t.mock.timers.tick(1);
  await Promise.resolve();
  assert.equal(games.hasSession(GROUP), false);
  assert.equal(socket.sent.length, 1);
  assert.match(socket.sent[0].content.text, /TIMED OUT/);
  assert.match(socket.sent[0].content.text, /@111/);
});

test('a valid move restarts the turn deadline', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { games, socket } = setup({ turnTimeoutMs: 1000 });
  t.mock.timers.tick(800);
  await say(games, '5', { senderJid: MEMBER });
  t.mock.timers.tick(800);
  assert.equal(games.hasSession(GROUP), true);
  t.mock.timers.tick(200);
  await Promise.resolve();
  assert.equal(games.hasSession(GROUP), false);
  assert.match(socket.sent.at(-1).content.text, /TIMED OUT/);
});

test('a valid X move in an open game resets the turn deadline', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { games, socket } = setup({ opponentJid: null, turnTimeoutMs: 1000 });
  t.mock.timers.tick(800);
  await say(games, '5', { senderJid: MEMBER });
  t.mock.timers.tick(800);
  assert.equal(games.hasSession(GROUP), true);
  assert.equal(games.get(GROUP).data.oJid, null);
  t.mock.timers.tick(200);
  await Promise.resolve();
  assert.equal(games.hasSession(GROUP), false);
  assert.match(socket.sent.at(-1).content.text, /TIMED OUT/);
});

test('an occupied-cell attempt does not reset the turn deadline', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { games, session, socket } = setup({ turnTimeoutMs: 1000 });
  await say(games, '5', { senderJid: MEMBER });
  t.mock.timers.tick(800);
  await say(games, '5', { senderJid: OTHER });
  assert.match(socket.sent.at(-1).content.text, /CELL TAKEN/);
  assert.equal(session.data.board[4], 'X');
  assert.equal(session.data.turn, 'O');
  t.mock.timers.tick(200);
  await Promise.resolve();
  assert.equal(games.hasSession(GROUP), false);
  assert.match(socket.sent.at(-1).content.text, /TIMED OUT/);
});

test('ending or replacing a session prevents its old timer from firing', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { games, socket } = setup({ turnTimeoutMs: 1000 });
  games.end(GROUP);
  const replacement = startTicTacToe(games, GROUP, {
    starterJid: OTHER,
    opponentJid: SPECTATOR,
    turnTimeoutMs: 2000,
  });
  t.mock.timers.tick(1000);
  await Promise.resolve();
  assert.equal(socket.sent.length, 0);
  assert.equal(games.get(GROUP), replacement);

  t.mock.timers.tick(1000);
  await Promise.resolve();
  assert.equal(games.hasSession(GROUP), false);
  assert.match(socket.sent[0].content.text, /@222/);
});

// ── participant departures ──────────────────────────────────────────────────

test('a non-player leaving does not disturb the game', async () => {
  const { games, session, socket } = setup();
  assert.equal(await games.handlePlayerLeave(GROUP, SPECTATOR), true);
  assert.equal(games.get(GROUP), session);
  assert.equal(socket.sent.length, 0);
});

test('a player leaving ends the game and the remaining player wins by forfeit', async () => {
  const { games, socket } = setup();
  assert.equal(await games.handlePlayerLeave(GROUP, OTHER), true);
  assert.equal(games.hasSession(GROUP), false);
  assert.equal(socket.sent.length, 1);
  assert.match(socket.sent[0].content.text, /FORFEIT/);
  assert.match(socket.sent[0].content.text, /@222 left/);
  assert.match(socket.sent[0].content.text, /@111 wins by forfeit/);
  assert.deepEqual(socket.sent[0].content.mentions, [OTHER, MEMBER]);
});

test('a departure is matched through aliases even after metadata no longer lists the player', async () => {
  const groupMeta = {
    participants: [{ id: '5@lid', phoneNumber: '2348012345678@s.whatsapp.net' }, { id: OTHER }],
  };
  const { games, socket } = setup({ starterJid: '5@lid', groupMeta });
  const afterRemoval = { participants: [{ id: OTHER }] };
  assert.equal(
    await games.handlePlayerLeave(GROUP, '2348012345678@s.whatsapp.net', { groupMeta: afterRemoval }),
    true,
  );
  assert.equal(games.hasSession(GROUP), false);
  assert.match(socket.sent[0].content.text, /FORFEIT/);
  assert.match(socket.sent[0].content.text, /@222 wins by forfeit/);
});

test('the starter leaving an open game cancels it', async () => {
  const { games, socket } = setup({ opponentJid: null });
  await games.handlePlayerLeave(GROUP, MEMBER);
  assert.equal(games.hasSession(GROUP), false);
  assert.match(socket.sent[0].content.text, /CANCELLED/);
});

test('departures only affect the matching chat and game', async () => {
  const { games, session } = setup();
  const other = startTicTacToe(games, OTHER_GROUP, { starterJid: SPECTATOR, opponentJid: OTHER });
  assert.equal(await games.handlePlayerLeave(OTHER_GROUP, OTHER), true);
  assert.equal(games.get(GROUP), session);
  assert.equal(games.hasSession(OTHER_GROUP), false);
  assert.ok(other.ended);
});

test('games without a departure hook are left alone', async () => {
  const games = createGameManager({ logger: silent });
  const session = games.start(GROUP, {
    type: 'guess',
    game: { onText() {} },
    starterJid: MEMBER,
  });
  assert.equal(await games.handlePlayerLeave(GROUP, MEMBER), false);
  assert.equal(games.get(GROUP), session);
  games.shutdown();
});

// ── command integration ─────────────────────────────────────────────────────

test('tictactoe is a public fun command with the ttt alias', async () => {
  assert.equal(tictactoeCommand.name, 'tictactoe');
  assert.deepEqual(tictactoeCommand.aliases, ['ttt']);
  assert.equal(tictactoeCommand.category, 'fun');
  assert.deepEqual(tictactoeCommand.permissions, ['public']);

  const registry = await loadCommands(path.join(ROOT, 'commands'), silent);
  assert.equal(registry.get('tictactoe'), registry.get('ttt'));
  assert.equal(registry.get('ttt').category, 'fun');
  assert.match(registry.get('ttt').source, /commands[\\/]fun[\\/]tictactoe\.js$/);
});

test('the command starts a game against the mentioned target', async () => {
  const games = createGameManager({ logger: silent });
  const { ctx, replies } = makeCtx(games, { targetJid: OTHER });
  await tictactoeCommand.execute(ctx);
  const session = games.get(GROUP);
  assert.equal(session.type, 'tictactoe');
  assert.equal(session.data.xJid, MEMBER);
  assert.equal(session.data.oJid, OTHER);
  assert.match(replies[0].text, /TIC TAC TOE/);
  assert.deepEqual(replies[0].options.mentions, [MEMBER, OTHER]);
  games.shutdown();
});

test('the command starts an open game when no target is supplied', async () => {
  const games = createGameManager({ logger: silent });
  const { ctx, replies } = makeCtx(games);
  await tictactoeCommand.execute(ctx);
  assert.equal(games.get(GROUP).data.oJid, null);
  assert.match(replies[0].text, /opponent joins/i);
  games.shutdown();
});

test('the command shows status, plays moves and validates cells while a game runs', async () => {
  const { games, session } = setup();
  const status = makeCtx(games);
  await tictactoeCommand.execute(status.ctx);
  assert.match(status.replies[0].text, /IN PROGRESS/);

  const move = makeCtx(games, { args: ['5'], argsText: '5' });
  await tictactoeCommand.execute(move.ctx);
  assert.equal(session.data.board[4], 'X');
  assert.match(move.replies[0].text, /placed X/);

  const invalid = makeCtx(games, { args: ['10'], argsText: '10' });
  await assert.rejects(() => tictactoeCommand.execute(invalid.ctx), CommandError);

  const spectator = makeCtx(games, { args: ['2'], argsText: '2', senderJid: SPECTATOR });
  await assert.rejects(() => tictactoeCommand.execute(spectator.ctx), CommandError);
  assert.equal(session.data.board[1], null);
  assert.equal(games.get(GROUP), session);
});

test('the command joins an open seat and refuses to start over another game', async () => {
  const { games } = setup({ opponentJid: null });
  const join = makeCtx(games, { args: ['join'], argsText: 'join', senderJid: OTHER });
  await tictactoeCommand.execute(join.ctx);
  assert.equal(games.get(GROUP).data.oJid, OTHER);

  const other = createGameManager({ logger: silent });
  other.start(GROUP, { type: 'trivia', game: { onText() {} }, starterJid: MEMBER });
  const { ctx } = makeCtx(other, { targetJid: OTHER });
  await assert.rejects(
    () => tictactoeCommand.execute(ctx),
    (error) => error instanceof CommandError && /already running/.test(error.message),
  );
  assert.equal(other.get(GROUP).type, 'trivia');
  other.shutdown();
});

test('the command fails cleanly without a game engine', async () => {
  const { ctx } = makeCtx(null);
  await assert.rejects(() => tictactoeCommand.execute(ctx), CommandError);
});

test('the command works in a direct chat with an open seat', async () => {
  const games = createGameManager({ logger: silent });
  const { ctx } = makeCtx(games, { chatJid: MEMBER, isGroup: false });
  await tictactoeCommand.execute(ctx);
  assert.equal(games.get(MEMBER).type, 'tictactoe');
  assert.equal(games.get(MEMBER).data.oJid, null);
  games.shutdown();
});
