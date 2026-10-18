import { fullFrame } from '../../lib/formatter.js';
import { CommandError } from '../../lib/helpers.js';

export default {
  name: 'seal',
  aliases: ['sealcommands'],
  description: 'Seal bot commands to administrators only.',
  category: 'security',
  usage: 'seal [on|off]',
  permissions: ['admin'],
  async execute(ctx) {
    const value = (ctx.args[0] || '').toLowerCase();
    let next = ctx.group?.sealed ? 0 : 1;
    if (['on', 'true', '1', 'enable'].includes(value)) next = 1;
    else if (['off', 'false', '0', 'disable'].includes(value)) next = 0;
    else if (value) throw new CommandError('Use on or off.');
    ctx.db.updateGroup(ctx.chatJid, { sealed: next });
    await ctx.reply(
      fullFrame('🔐 SEAL', [
        `🩸 COMMAND SEAL: ${next ? 'ACTIVE' : 'BROKEN'}`,
        next
          ? 'Only administrators may invoke curses in this domain.'
          : 'Every soul may invoke curses again.',
      ]),
    );
  },
};
