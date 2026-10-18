import { fullFrame } from '../../lib/formatter.js';
import { moderationTarget } from '../../lib/command-utils.js';

export default {
  name: 'pardon',
  aliases: ['unwarn'],
  description: 'Erase every warning from a soul\'s record in this domain.',
  category: 'domain',
  usage: 'pardon <@user>',
  permissions: ['admin'],
  async execute(ctx) {
    const target = moderationTarget(ctx);
    const previous = ctx.db.countWarnings(ctx.chatJid, target);
    const cleared = ctx.db.clearWarnings(ctx.chatJid, target);
    ctx.db.logModeration(ctx.chatJid, 'pardon', target, ctx.senderJid, `Cleared ${cleared} warnings`);
    await ctx.reply(
      fullFrame('🕊 PARDON', [
        `🩸 SOUL: @${target.split('@')[0]}`,
        `⛓ WARNINGS ERASED: ${cleared}${previous && !cleared ? ' (none could be cleared)' : ''}`,
        'The record is lighter. The King\'s memory is not.',
      ]),
      { mentions: [target] },
    );
  },
};
