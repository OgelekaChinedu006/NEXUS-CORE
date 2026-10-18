import { fullFrame, menu } from '../../lib/formatter.js';

export default {
  name: 'shrine',
  aliases: ['menu', 'commands'],
  description: 'Reveal every bound curse, grouped by domain.',
  category: 'general',
  usage: 'shrine [category]',
  permissions: ['public'],
  cooldownMs: 3000,
  async execute(ctx) {
    const filter = (ctx.args[0] || '').toLowerCase();
    const categories = ctx.registry.categories();
    const visible = filter
      ? categories.filter(
          (category) =>
            category.id === filter ||
            category.label.toLowerCase() === filter ||
            category.label.toLowerCase().replace(/\s+/g, '') === filter,
        )
      : categories;

    if (filter && visible.length === 0) {
      await ctx.reply(
        fullFrame('☠️ UNKNOWN DOMAIN', [
          `No category named "${filter}" is bound.`,
          '',
          'Available domains:',
          ...categories.map((category) => `▸ ${category.label} — ${ctx.prefix}shrine ${category.id}`),
          '',
          `> ${ctx.prefix}beg <command> reveals a single curse.`,
        ]),
      );
      return;
    }

    await ctx.reply(
      menu({
        prefix: ctx.prefix,
        version: ctx.config.version,
        categories: visible,
        total: ctx.registry.size,
        botName: ctx.config.botName,
        slogan: ctx.config.shrine.slogan,
      }),
    );
  },
};
