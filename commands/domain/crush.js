import { fullFrame } from '../../lib/formatter.js';
import { apiFailure, isParticipantAdmin, moderationTarget } from '../../lib/command-utils.js';

export default {
  name: 'crush',
  aliases: ['demote'],
  description: 'Strip administrator authority from a soul.',
  category: 'domain',
  usage: 'crush <@user>',
  permissions: ['admin', 'botAdmin'],
  async execute(ctx) {
    const target = moderationTarget(ctx);
    if (!isParticipantAdmin(ctx.groupMeta, target)) {
      await ctx.reply(fullFrame('☠️ NO AUTHORITY', ['That soul holds no admin power to strip.']));
      return;
    }
    try {
      await ctx.sock.groupParticipantsUpdate(ctx.chatJid, [target], 'demote');
    } catch (error) {
      throw apiFailure('crush', error);
    }
    ctx.db.logModeration(ctx.chatJid, 'crush', target, ctx.senderJid, 'Demoted from admin');
    await ctx.reply(
      fullFrame('⚔️ CRUSHED', [
        `🩸 AUTHORITY REMOVED: @${target.split('@')[0]}`,
        'The domain remembers rank. It does not mourn it.',
      ]),
      { mentions: [target] },
    );
  },
};
