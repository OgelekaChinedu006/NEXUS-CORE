import { executeRuneCommand } from '../../lib/rune-commands.js';

export default {
  name: 'callrune',
  aliases: ['callward'],
  description: 'Configure the Call Rune against private calls to the vessel.',
  category: 'atlas-rune',
  usage: 'callrune [on|off|mercy|grace|reset @user|status|help]',
  permissions: ['sudo'],
  cooldownMs: 2000,
  async execute(ctx) {
    await executeRuneCommand(ctx, 'call');
  },
};
