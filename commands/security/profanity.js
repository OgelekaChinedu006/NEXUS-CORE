import { fullFrame } from '../../lib/formatter.js';
import { CommandError } from '../../lib/helpers.js';

export default {
  name: 'profanity',
  aliases: ['cleanse'],
  description: 'Ward the domain against profane speech.',
  category: 'security',
  usage: 'profanity [on|off]',
  permissions: ['admin'],
  async execute(ctx) {
    const value = (ctx.args[0] || '').toLowerCase();
    let next = ctx.group?.profanity ? 0 : 1;
    if (['on', 'true', '1', 'enable'].includes(value)) next = 1;
    else if (['off', 'false', '0', 'disable'].includes(value)) next = 0;
    else if (value) throw new CommandError('Use on or off.');
    ctx.db.updateGroup(ctx.chatJid, { profanity: next });
    await ctx.reply(
      fullFrame('🩸 PROFANITY WARD', [
        `⛓ STATUS: ${next ? 'ACTIVE' : 'DORMANT'}`,
        next
          ? 'Foul words will be deleted and the speaker marked.'
          : 'The tongue is unbound. The King is watching.',
      ]),
    );
  },
};
