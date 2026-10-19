import { CommandError } from '../../lib/helpers.js';
import {
  GUESS_MAX,
  GUESS_MIN,
  describeGuessStart,
  describeGuessStatus,
  isInGuessRange,
  processGuess,
  startGuess,
} from '../../lib/games/guess.js';

export default {
  name: 'guess',
  aliases: [],
  description: 'Guess a hidden number from 1 to 100 within 7 attempts.',
  category: 'fun',
  usage: 'guess [number]',
  permissions: ['public'],
  cooldownMs: 1000,
  async execute(ctx) {
    if (!ctx.games) throw new CommandError('The game engine is not available.');
    const session = ctx.games.get(ctx.chatJid);

    if (session && session.type === 'guess') {
      if (ctx.args.length === 0) {
        await ctx.reply(describeGuessStatus(session));
        return;
      }
      const raw = ctx.args[0];
      if (!/^\d{1,6}$/.test(raw)) throw new CommandError(`Name a whole number from ${GUESS_MIN} to ${GUESS_MAX}.`);
      const value = Number(raw);
      if (!isInGuessRange(value, session.data)) {
        throw new CommandError(`Name a whole number from ${session.data.min} to ${session.data.max}.`);
      }
      const outcome = processGuess(session, value, ctx.senderJid);
      if (outcome) {
        await ctx.reply(outcome.text, outcome.mentions.length ? { mentions: outcome.mentions } : {});
      }
      return;
    }

    // No guess game here: start one. If a different game is running, the
    // manager throws its "already running" CommandError.
    const started = startGuess(ctx.games, ctx.chatJid, {
      starterJid: ctx.senderJid,
      socket: ctx.sock || null,
    });
    await ctx.reply(describeGuessStart(started, ctx.prefix));
  },
};
