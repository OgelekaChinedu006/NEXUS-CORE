import { CommandError } from '../../lib/helpers.js';
import {
  SEQUENCE_DIFFICULTIES,
  describeSequenceStart,
  describeSequenceStatus,
  isQuitCommand,
  parseDifficulty,
  parseSequenceAnswer,
  processSequence,
  quitSequence,
  startSequence,
} from '../../lib/games/sequence.js';

export default {
  name: 'sequence',
  aliases: ['seq'],
  description: 'Find the next number in a curated sequence puzzle.',
  category: 'fun',
  usage: 'sequence [easy|medium|hard|number|status|quit]',
  permissions: ['public'],
  cooldownMs: 1000,
  async execute(ctx) {
    if (!ctx.games) throw new CommandError('The game engine is not available.');
    const session = ctx.games.get(ctx.chatJid);

    if (session && session.type === 'sequence') {
      if (ctx.args.length === 0 || ctx.args[0].trim().toLowerCase() === 'status') {
        await ctx.reply(describeSequenceStatus(session));
        return;
      }

      if (isQuitCommand(ctx.args[0])) {
        const outcome = quitSequence(session, ctx.senderJid);
        if (outcome) {
          await ctx.reply(outcome.text, outcome.mentions.length ? { mentions: outcome.mentions } : {});
        }
        return;
      }

      const value = parseSequenceAnswer(ctx.args[0]);
      if (value === null) {
        throw new CommandError('Name a whole number for the next term.');
      }
      const outcome = processSequence(session, value, ctx.senderJid);
      if (outcome) {
        await ctx.reply(outcome.text, outcome.mentions.length ? { mentions: outcome.mentions } : {});
      }
      return;
    }

    const difficulty = ctx.args.length === 0 ? 'easy' : parseDifficulty(ctx.args[0]);
    if (ctx.args.length > 0 && !difficulty) {
      throw new CommandError(`Choose a difficulty: ${SEQUENCE_DIFFICULTIES.join(', ')}.`);
    }
    const started = startSequence(ctx.games, ctx.chatJid, {
      starterJid: ctx.senderJid,
      socket: ctx.sock || null,
      difficulty,
    });
    await ctx.reply(describeSequenceStart(started, ctx.prefix));
  },
};
