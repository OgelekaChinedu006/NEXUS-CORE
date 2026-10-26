import { executeRuneCommand } from '../../lib/rune-commands.js';

export default {
  name: 'linkrune',
  aliases: ['linkward'],
  description: 'Configure the Link Rune against outside URLs.',
  category: 'atlas-rune',
  usage: 'linkrune [on|off|mercy|grace|exile|reset @user|status|help]',
  permissions: ['admin'],
  cooldownMs: 2000,
  async execute(ctx) {
    await executeRuneCommand(ctx, 'link');
  },
};
