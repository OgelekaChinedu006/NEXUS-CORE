import { fullFrame } from '../../lib/formatter.js';
import { sanitizeField } from '../../lib/helpers.js';

export default {
  name: 'edict',
  aliases: ['announce'],
  description: 'Speak an edict into the domain.',
  category: 'domain',
  usage: 'edict <message>',
  permissions: ['admin'],
  cooldownMs: 5000,
  async execute(ctx) {
    const message = sanitizeField(ctx.argsText, 2000);
    if (!message) {
      await ctx.reply(fullFrame('☠️ EMPTY EDICT', ['Speak the words you want the domain to hear.']));
      return;
    }
    await ctx.reply(fullFrame('📜 EDICT', [message]));
  },
};
