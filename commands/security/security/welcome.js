import { fullFrame } from '../../lib/formatter.js';
import { CommandError } from '../../lib/helpers.js';

export default {
  name: 'welcome',
  aliases: ['welcomerite'],
  description: 'Toggle the domain incarnation rite for new souls.',
  category: 'security',
  usage: 'welcome [on|off|status]',
  permissions: ['admin'],
  async execute(ctx) {
    const value = (ctx.args[0] || 'status').toLowerCase();
    if (value === 'status') {
      await ctx.reply(
        fullFrame('👹 INCARNATION RITE', [
          `🩸 STATUS: ${ctx.group?.welcome_enabled ? 'ACTIVE' : 'DORMANT'}`,
          `⚡ TEMPLATE: ${ctx.group?.welcome_text ? 'custom' : 'default'}`,
          `🩸 Set custom words with ${ctx.prefix}inscribe <text>.`,
        ]),
      );
      return;
    }

    let next = ctx.group?.welcome_enabled ? 0 : 1;
    if (['on', 'true', '1', 'enable'].includes(value)) next = 1;
    else if (['off', 'false', '0', 'disable'].includes(value)) next = 0;
    else throw new CommandError('Use on, off or status.');

    ctx.db.updateGroup(ctx.chatJid, { welcome_enabled: next });
    await ctx.reply(
      fullFrame('👹 INCARNATION RITE', [
        `🩸 STATUS: ${next ? 'ACTIVE' : 'DORMANT'}`,
        next ? 'New souls will be announced when they enter.' : 'New souls will enter in silence.',
      ]),
    );
  },
};
