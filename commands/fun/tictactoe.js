import { CommandError } from '../../lib/helpers.js';
import {
  describeTicTacToeStart,
  describeTicTacToeStatus,
  joinTicTacToe,
  parseMove,
  processMove,
  startTicTacToe,
} from '../../lib/games/tictactoe.js';

export default {
  name: 'tictactoe',
  aliases: ['ttt'],
  description: 'Play a two-player tic-tac-toe game in the chat.',
  category: 'fun',
  usage: 'tictactoe [@player|1-9]',
  permissions: ['public'],
  cooldownMs: 1000,
  async execute(ctx) {
    if (!ctx.games) throw new CommandError('The game engine is not available.');
    const session = ctx.games.get(ctx.chatJid);

    if (session && session.type === 'tictactoe') {
      if (ctx.args.length === 0) {
        await ctx.reply(describeTicTacToeStatus(session));
        return;
      }

      if (ctx.args[0].trim().toLowerCase() === 'join') {
        const outcome = joinTicTacToe(session, ctx.senderJid, { groupMeta: ctx.groupMeta });
        if (!outcome) {
          throw new CommandError('This game already has two players, or you are already the starter.');
        }
        await ctx.reply(outcome.text, { mentions: outcome.mentions });
        return;
      }

      const cell = parseMove(ctx.args[0]);
      if (cell === null) throw new CommandError('Choose a cell number from 1 to 9.');

      const outcome = processMove(session, cell, ctx.senderJid, { groupMeta: ctx.groupMeta });
      if (!outcome) {
        throw new CommandError('Only the two players may move. Wait for an open seat or start your own game.');
      }
      await ctx.reply(outcome.text, outcome.mentions.length ? { mentions: outcome.mentions } : {});
      return;
    }

    const opponentJid = ctx.targetJid || null;
    const started = startTicTacToe(ctx.games, ctx.chatJid, {
      starterJid: ctx.senderJid,
      opponentJid,
      socket: ctx.sock || null,
      groupMeta: ctx.groupMeta || null,
    });
    await ctx.reply(describeTicTacToeStart(started), {
      mentions: [started.data.xJid, started.data.oJid].filter(Boolean),
    });
  },
};
