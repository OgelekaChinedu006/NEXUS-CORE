import { CommandError } from '../../lib/helpers.js';
import {
  WORD_DEDUCTION_WORD_LENGTH,
  describeWordDeductionStart,
  describeWordDeductionStatus,
  isFiveLetterWord,
  isQuitCommand,
  parseWordDeduction,
  processWordDeduction,
  quitWordDeduction,
  startWordDeduction,
} from '../../lib/games/worddeduction.js';

export default {
  name: 'worddeduction',
  aliases: ['wd'],
  description: 'Deduce a hidden five-letter word within six valid guesses.',
  category: 'fun',
  usage: 'worddeduction [word|status|quit]',
  permissions: ['public'],
  cooldownMs: 1000,
  async execute(ctx) {
    if (!ctx.games) throw new CommandError('The game engine is not available.');
    const session = ctx.games.get(ctx.chatJid);

    if (session && session.type === 'worddeduction') {
      if (ctx.args.length === 0 || ctx.args[0].trim().toLowerCase() === 'status') {
        await ctx.reply(describeWordDeductionStatus(session));
        return;
      }

      if (isQuitCommand(ctx.args[0])) {
        const outcome = quitWordDeduction(session, ctx.senderJid);
        if (outcome) {
          await ctx.reply(outcome.text, outcome.mentions.length ? { mentions: outcome.mentions } : {});
        }
        return;
      }

      const word = parseWordDeduction(ctx.args[0]);
      if (word === null || !isFiveLetterWord(word)) {
        throw new CommandError(`Name a complete ${WORD_DEDUCTION_WORD_LENGTH}-letter word.`);
      }
      const outcome = processWordDeduction(session, word, ctx.senderJid);
      if (outcome) {
        await ctx.reply(outcome.text, outcome.mentions.length ? { mentions: outcome.mentions } : {});
      }
      return;
    }

    const started = startWordDeduction(ctx.games, ctx.chatJid, {
      starterJid: ctx.senderJid,
      socket: ctx.sock || null,
    });
    await ctx.reply(describeWordDeductionStart(started, ctx.prefix));
  },
};
