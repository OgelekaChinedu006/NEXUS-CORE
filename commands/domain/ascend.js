import { fullFrame } from '../../lib/formatter.js';
import { apiFailure, isParticipantAdmin, moderationTarget } from '../../lib/command-utils.js';

export default {
  name: 'ascend',
  aliases: ['promote'],
  description: 'Elevate a soul to administrator of the domain.',
  category: 'domain',
  usage: 'ascend <@user>',
  permissions: ['admin', 'botAdmin'],
  async execute(ctx) {
    const target = moderationTarget(ctx);
    if (isParticipantAdmin(ctx.groupMeta, target)) {
      await ctx.reply(fullFrame('☠️ ALREADY ELEVATED', ['That soul already holds admin authority.']));
      return;
    }
    try {
      await ctx.sock.groupParticipantsUpdate(ctx.chatJid, [target], 'promote');
    } catch (error) {
      throw apiFailure('ascend', error);
    }
    ctx.db.logModeration(ctx.chatJid, 'ascend', target, ctx.senderJid, 'Promoted to admin');
    await ctx.reply(
      fullFrame('👑 ASCENSION', [
        `⚡ SOUL ELEVATED: @${target.split('@')[0]}`,
        '🩸 The throne now acknowledges their authority.',
      ]),
      { mentions: [target] },
    );
  },
};
