import { fullFrame } from '../../lib/formatter.js';
import { apiFailure } from '../../lib/command-utils.js';

export default {
  name: 'release',
  aliases: ['unmute'],
  description: 'Release the domain and return speech to its souls.',
  category: 'domain',
  usage: 'release',
  permissions: ['admin', 'botAdmin'],
  async execute(ctx) {
    try {
      await ctx.sock.groupSettingUpdate(ctx.chatJid, 'not_announcement');
    } catch (error) {
      throw apiFailure('release', error);
    }
    ctx.db.logModeration(ctx.chatJid, 'release', null, ctx.senderJid, 'Domain speech reopened');
    await ctx.reply(
      fullFrame('🔓 RELEASE', [
        '🩸 The seal is broken.',
        'Every soul may speak again. Do not waste the privilege.',
      ]),
    );
  },
};
