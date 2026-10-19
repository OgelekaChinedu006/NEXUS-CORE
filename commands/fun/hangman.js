import { CommandError } from '../../lib/helpers.js';
import {
  describeHangmanStart,
  describeHangmanStatus,
  isQuitCommand,
  parseHangmanLetter,
  processHangman,
  quitHangman,
  startHangman,
} from '../../lib/games/hangman.js';

export default {
  name: 'hangman',
  aliases: ['hm'],
  description: 'Guess a hidden word one letter at a time before the figure is complete.',
  category: 'fun',
  usage: 'hangman [letter|status|quit]',
  permissions: ['public'],
  cooldownMs: 1000,
  async execute(ctx) {
    if (!ctx.games) throw new CommandError('The game engine is not available.');
    const session = ctx.games.get(ctx.chatJid);

    if (session && session.type === 'hangman') {
      if (ctx.args.length === 0 || ctx.args[0].trim().toLowerCase() === 'status') {
        await ctx.reply(describeHangmanStatus(session));
        return;
      }

      if (isQuitCommand(ctx.args[0])) {
        const outcome = quitHangman(session, ctx.senderJid);
        if (outcome) {
          await ctx.reply(outcome.text, outcome.mentions.length ? { mentions: outcome.mentions } : {});
        }
        return;
      }

      const letter = parseHangmanLetter(ctx.args[0]);
      if (letter === null) {
        throw new CommandError('Name a single letter A–Z.');
      }
      const outcome = processHangman(session, letter, ctx.senderJid);
      if (outcome) {
        await ctx.reply(outcome.text, outcome.mentions.length ? { mentions: outcome.mentions } : {});
      }
      return;
    }

    const started = startHangman(ctx.games, ctx.chatJid, {
      starterJid: ctx.senderJid,
      socket: ctx.sock || null,
    });
    await ctx.reply(describeHangmanStart(started, ctx.prefix));
  },
};
