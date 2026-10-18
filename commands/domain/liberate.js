import { fullFrame } from '../../lib/formatter.js';
import { apiFailure } from '../../lib/command-utils.js';

export default {
  name: 'liberate',
  aliases: ['unlock'],
  description: 'Open the domain: free speech and open admission restored.',
  category: 'domain',
  usage: 'liberate',
  permissions: ['admin', 'botAdmin'],
  async execute(ctx) {
    try {
      await ctx.sock.groupSettingUpdate(ctx.chatJid, 'not_announcement');
      await ctx.sock.groupMemberAddMode(ctx.chatJid, 'all_member_add');
    } catch (error) {
      throw apiFailure('liberate', error);
    }
    ctx.db.updateGroup(ctx.chatJid, { member_add_mode: 'all_member_add' });
    ctx.db.logModeration(ctx.chatJid, 'liberate', null, ctx.senderJid, 'Domain liberated');
    await ctx.reply(
      fullFrame('🔓 LIBERATION', [
        '🩸 Speech is free again.',
        '⛓ Every member may admit new souls.',
        'Order is a choice now. Choose wisely.',
      ]),
    );
  },
};
