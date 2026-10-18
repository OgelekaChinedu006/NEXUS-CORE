import { fullFrame } from '../../lib/formatter.js';

export default {
  name: 'hierarchy',
  aliases: ['richest', 'leaderboard'],
  description: 'Read the hierarchy of cursed wealth across the domain.',
  category: 'economy',
  usage: 'hierarchy',
  permissions: ['public'],
  cooldownMs: 5000,
  async execute(ctx) {
    const top = ctx.db.topBalances(10);
    if (!top.length) {
      await ctx.reply(fullFrame('👑 HIERARCHY', ['No soul has claimed a single coin.']));
      return;
    }

    const medals = ['🥇', '🥈', '🥉'];
    await ctx.reply(
      fullFrame('👑 HIERARCHY', [
        ...top.map(
          (entry, index) =>
            `${medals[index] || '▸'} @${entry.user_jid.split('@')[0]} — ${entry.balance}`,
        ),
        '',
        '> Wealth is remembered. Mercy is not.',
      ]),
      { mentions: top.map((entry) => entry.user_jid) },
    );
  },
};
