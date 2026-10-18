import { fullFrame } from '../../lib/formatter.js';
import { apiFailure, cleanReason, findParticipant, moderationTarget } from '../../lib/command-utils.js';
import { removeParticipant } from '../../lib/moderation.js';

export default {
  name: 'exile',
  aliases: ['ban'],
  description: 'Banish a soul from the domain and bar their return.',
  category: 'domain',
  usage: 'exile <@user> [reason]',
  permissions: ['admin', 'botAdmin'],
  async execute(ctx) {
    const target = moderationTarget(ctx);
    if (!findParticipant(ctx.groupMeta, target)) {
      await ctx.reply(fullFrame('☠️ NO SUCH SOUL', ['That soul is not present in this domain.']));
      return;
    }
    const reason = cleanReason(ctx.argsText, 'Exiled by the throne.');
    ctx.db.banFromGroup(ctx.chatJid, target, reason, ctx.senderJid);
    try {
      await removeParticipant({ sock: ctx.sock, groupJid: ctx.chatJid, targetJid: target });
    } catch (error) {
      ctx.logger.warn(`Exile kick failed: ${error.message}`);
      throw apiFailure('exile', error);
    }
    ctx.db.logModeration(ctx.chatJid, 'exile', target, ctx.senderJid, reason);
    await ctx.reply(
      fullFrame('🚫 EXILE', [
        `🩸 SOUL BANISHED: @${target.split('@')[0]}`,
        `⛓ REASON: ${reason}`,
        '☠️ The gate will reject them if they return.',
      ]),
      { mentions: [target] },
    );
  },
};
