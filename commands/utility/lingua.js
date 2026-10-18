import { fullFrame } from '../../lib/formatter.js';
import { CommandError, truncate } from '../../lib/helpers.js';

const LANGUAGE = /^(auto|[a-z]{2,3}(?:-[a-z]{2,4})?)$/i;

export default {
  name: 'lingua',
  aliases: ['translate'],
  description: 'Transmute words from one tongue into another.',
  category: 'utility',
  usage: 'lingua <from> <to> <text>',
  permissions: ['public'],
  cooldownMs: 5000,
  async execute(ctx) {
    if (!ctx.services.translation) {
      throw new CommandError('The translation spirits are not bound to this vessel.');
    }
    if (ctx.args.length < 2) {
      throw new CommandError('Use: lingua <from> <to> <text>, or lingua <to> <text> for auto-detection.');
    }

    let source = 'auto';
    let target;
    let text;
    if (ctx.args.length >= 3 && LANGUAGE.test(ctx.args[0]) && LANGUAGE.test(ctx.args[1])) {
      source = ctx.args[0].toLowerCase();
      target = ctx.args[1].toLowerCase();
      text = ctx.args.slice(2).join(' ');
    } else {
      target = ctx.args[0].toLowerCase();
      text = ctx.args.slice(1).join(' ');
    }

    if (!LANGUAGE.test(target) || target === 'auto') {
      throw new CommandError('Name a valid target language, for example: en, es, fr, pt-BR.');
    }

    const result = await ctx.services.translation.translate({ text, source, target });
    await ctx.reply(
      fullFrame('📜 LINGUA', [
        `🩸 SOURCE: ${source}`,
        `⚡ TARGET: ${result.target}`,
        `👁 PROVIDER: ${result.provider}`,
        '',
        truncate(result.text, 3000),
      ]),
    );
  },
};
