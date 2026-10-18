import { fullFrame } from '../../lib/formatter.js';
import { apiFailure } from '../../lib/command-utils.js';

export default {
  name: 'domainlink',
  aliases: ['invite'],
  description: 'Forge an invite gate into the current domain.',
  category: 'domain',
  usage: 'domainlink',
  permissions: ['admin', 'botAdmin'],
  cooldownMs: 10000,
  async execute(ctx) {
    let code;
    try {
      code = await ctx.sock.groupInviteCode(ctx.chatJid);
    } catch (error) {
      throw apiFailure('invite-link', error);
    }
    if (!code) {
      await ctx.reply(fullFrame('☠️ NO GATE', ['WhatsApp returned no invite code for this domain.']));
      return;
    }
    await ctx.reply(
      fullFrame('🔗 DOMAIN GATE', [
        `🩸 INVITE: https://chat.whatsapp.com/${code}`,
        '⚠️ Anyone holding this gate can enter. Guard it.',
      ]),
    );
  },
};
