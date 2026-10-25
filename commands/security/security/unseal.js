import { fullFrame } from '../../lib/formatter.js';

export default {
  name: 'unseal',
  aliases: [],
  description: 'Break the command seal and let every soul invoke curses.',
  category: 'security',
  usage: 'unseal',
  permissions: ['admin'],
  async execute(ctx) {
    ctx.db.updateGroup(ctx.chatJid, { sealed: 0 });
    await ctx.reply(
      fullFrame('🔓 UNSEALED', [
        '🩸 The command seal is broken.',
        'Every soul may invoke curses. The wards still watch.',
      ]),
    );
  },
};
