import { fullFrame } from '../../lib/formatter.js';
import { CommandError } from '../../lib/helpers.js';

export default {
  name: 'shorten',
  aliases: ['compress'],
  description: 'Compress a long gate into a shorter link.',
  category: 'utility',
  usage: 'shorten <url>',
  permissions: ['public'],
  cooldownMs: 5000,
  async execute(ctx) {
    const url = ctx.argsText.trim();
    if (!url) throw new CommandError('Provide the full http(s) URL to compress.');
    if (!ctx.services.utilities) throw new CommandError('The link spirits are not bound to this vessel.');
    const short = await ctx.services.utilities.shorten(url);
    await ctx.reply(fullFrame('🔗 SHORT GATE', [`🩸 ORIGINAL: ${url.slice(0, 500)}`, `⚡ SHORT: ${short}`]));
  },
};
