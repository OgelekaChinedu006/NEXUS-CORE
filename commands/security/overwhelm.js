import { fullFrame } from '../../lib/formatter.js';
import { CommandError } from '../../lib/helpers.js';

export default {
  name: 'overwhelm',
  aliases: ['antispam'],
  description: 'Ward the domain against message floods.',
  category: 'security',
  usage: 'overwhelm [on|off]',
  permissions: ['admin'],
  async execute(ctx) {
    const value = (ctx.args[0] || '').toLowerCase();
    let next = ctx.group?.antispam ? 0 : 1;
    if (['on', 'true', '1', 'enable'].includes(value)) next = 1;
    else if (['off', 'false', '0', 'disable'].includes(value)) next = 0;
    else if (value) throw new CommandError('Use on or off.');
    ctx.db.updateGroup(ctx.chatJid, { antispam: next });
    await ctx.reply(
      fullFrame('🌊 OVERWHELM WARD', [
        `🩸 STATUS: ${next ? 'ACTIVE' : 'DORMANT'}`,
        next
          ? `Floods above ${ctx.config.security.spamThreshold} messages in ${Math.round(ctx.config.security.spamWindowMs / 1000)}s will be cut down.`
          : 'The floodgates are open. Chaos may speak.',
      ]),
    );
  },
};
