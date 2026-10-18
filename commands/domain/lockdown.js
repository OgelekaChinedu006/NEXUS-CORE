import { fullFrame } from '../../lib/formatter.js';
import { apiFailure } from '../../lib/command-utils.js';

export default {
  name: 'lockdown',
  aliases: ['fortress'],
  description: 'Seal the domain: announcement-only speech and admin-only entry.',
  category: 'domain',
  usage: 'lockdown',
  permissions: ['admin', 'botAdmin'],
  async execute(ctx) {
    try {
      await ctx.sock.groupSettingUpdate(ctx.chatJid, 'announcement');
      await ctx.sock.groupMemberAddMode(ctx.chatJid, 'admin_add');
    } catch (error) {
      throw apiFailure('lockdown', error);
    }
    ctx.db.updateGroup(ctx.chatJid, { member_add_mode: 'admin_add' });
    ctx.db.logModeration(ctx.chatJid, 'lockdown', null, ctx.senderJid, 'Domain locked down');
    await ctx.reply(
      fullFrame('🔒 LOCKDOWN', [
        '🩸 Speech is sealed to administrators.',
        '⛓ Only administrators may admit new souls.',
        'The domain is a fortress until liberated.',
      ]),
    );
  },
};
