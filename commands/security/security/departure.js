import { fullFrame } from '../../lib/formatter.js';
import { CommandError } from '../../lib/helpers.js';

export default {
  name: 'departure',
  aliases: ['goodbye'],
  description: 'Toggle the domain departure rite for leaving souls.',
  category: 'security',
  usage: 'departure [on|off|status]',
  permissions: ['admin'],
  async execute(ctx) {
    const value = (ctx.args[0] || 'status').toLowerCase();
    if (value === 'status') {
      await ctx.reply(
        fullFrame('☠️ DEPARTURE RITE', [
          `🩸 STATUS: ${ctx.group?.goodbye_enabled ? 'ACTIVE' : 'DORMANT'}`,
          `⚡ TEMPLATE: ${ctx.group?.goodbye_text ? 'custom' : 'default'}`,
          `🩸 Set custom words with ${ctx.prefix}farewell <text>.`,
        ]),
      );
      return;
    }

    let next = ctx.group?.goodbye_enabled ? 0 : 1;
    if (['on', 'true', '1', 'enable'].includes(value)) next = 1;
    else if (['off', 'false', '0', 'disable'].includes(value)) next = 0;
    else throw new CommandError('Use on, off or status.');

    ctx.db.updateGroup(ctx.chatJid, { goodbye_enabled: next });
    await ctx.reply(
      fullFrame('☠️ DEPARTURE RITE', [
        `🩸 STATUS: ${next ? 'ACTIVE' : 'DORMANT'}`,
        next ? 'Leaving souls will be marked.' : 'Departures will pass unannounced.',
      ]),
    );
  },
};
