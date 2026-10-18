import { fullFrame } from '../../lib/formatter.js';
import { apiFailure, findParticipant, moderationTarget } from '../../lib/command-utils.js';
import { removeParticipant } from '../../lib/moderation.js';

export default {
  name: 'cleave',
  aliases: ['kick'],
  description: 'Sever one soul from the domain.',
  category: 'domain',
  usage: 'cleave <@user> [reason]',
  permissions: ['admin', 'botAdmin'],
  async execute(ctx) {
    const target = moderationTarget(ctx);
    if (!findParticipant(ctx.groupMeta, target)) {
      await ctx.reply(fullFrame('☠️ NO SUCH SOUL', ['That soul is not present in this domain.']));
      return;
    }
    try {
      await removeParticipant({ sock: ctx.sock, groupJid: ctx.chatJid, targetJid: target });
    } catch (error) {
      ctx.logger.warn(`Cleave failed: ${error.message}`);
      throw apiFailure('cleave', error);
    }
    ctx.db.logModeration(ctx.chatJid, 'cleave', target, ctx.senderJid, 'Removed from domain');
    await ctx.reply(
      fullFrame('⚔️ CLEAVE', [
        `🩸 SOUL SEVERED: @${target.split('@')[0]}`,
        '☠️ The domain closes behind them.',
      ]),
      { mentions: [target] },
    );
  },
};
