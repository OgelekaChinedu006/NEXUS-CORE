import { executeRuneCommand } from '../../lib/rune-commands.js';

export default {
  name: 'spamrune',
  aliases: ['floodrune'],
  description: 'Configure the Spam Rune against message floods.',
  category: 'atlas-rune',
  usage: 'spamrune [on|off|mercy|grace|exile|reset @user|status|help]',
  permissions: ['admin'],
  cooldownMs: 2000,
  async execute(ctx) {
    await executeRuneCommand(ctx, 'spam');
  },
};
