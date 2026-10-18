import { fullFrame } from '../../lib/formatter.js';
import { CommandError } from '../../lib/helpers.js';

function parseToggle(value, current) {
  if (!value) return current ? 0 : 1;
  if (['on', 'true', '1', 'enable'].includes(value)) return 1;
  if (['off', 'false', '0', 'disable'].includes(value)) return 0;
  throw new CommandError('Use on or off.');
}

export default {
  name: 'malevolent',
  aliases: ['antilink'],
  description: 'Ward the domain against outside links.',
  category: 'security',
  usage: 'malevolent [on|off]',
  permissions: ['admin'],
  async execute(ctx) {
    const next = parseToggle((ctx.args[0] || '').toLowerCase(), ctx.group?.antilink);
    ctx.db.updateGroup(ctx.chatJid, { antilink: next });
    await ctx.reply(
      fullFrame('🕸 MALEVOLENT WARD', [
        `🩸 STATUS: ${next ? 'ACTIVE' : 'DORMANT'}`,
        next
          ? 'Any outside link from an unshielded soul will be torn down.'
          : 'Links may pass. The domain is exposed.',
      ]),
    );
  },
};
