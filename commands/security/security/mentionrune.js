import { executeRuneCommand } from '../../lib/rune-commands.js';

export default {
  name: 'mentionrune',
  aliases: ['statusrune'],
  description: 'Configure the Mention Rune against status mentions of the Sovereign.',
  category: 'security',
  usage: 'mentionrune [on|off|mercy|grace|exile|reset @user|status|help]',
  permissions: ['admin'],
  cooldownMs: 2000,
  async execute(ctx) {
    await executeRuneCommand(ctx, 'mention');
  },
};
