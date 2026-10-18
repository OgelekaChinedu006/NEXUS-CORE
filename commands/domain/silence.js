import { fullFrame } from '../../lib/formatter.js';
import { apiFailure } from '../../lib/command-utils.js';

export default {
  name: 'silence',
  aliases: ['mute'],
  description: 'Close the domain so only the throne may speak.',
  category: 'domain',
  usage: 'silence',
  permissions: ['admin', 'botAdmin'],
  async execute(ctx) {
    try {
      await ctx.sock.groupSettingUpdate(ctx.chatJid, 'announcement');
    } catch (error) {
      throw apiFailure('silence', error);
    }
    ctx.db.logModeration(ctx.chatJid, 'silence', null, ctx.senderJid, 'Domain set to announcement mode');
    await ctx.reply(
      fullFrame('🤫 SILENCE', [
        '🩸 The domain has been sealed to the throne.',
        'Only administrators may speak until released.',
      ]),
    );
  },
};
