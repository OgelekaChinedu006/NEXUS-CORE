import { fullFrame } from '../../lib/formatter.js';

export default {
  name: 'wealth',
  aliases: ['economy'],
  description: 'Survey the total cursed wealth circulating in the vessel.',
  category: 'economy',
  usage: 'wealth',
  permissions: ['public'],
  cooldownMs: 5000,
  async execute(ctx) {
    const stats = ctx.db.economyStats();
    const account = ctx.db.getEconomy(ctx.senderJid);
    const top = ctx.db.topBalances(1)[0];

    await ctx.reply(
      fullFrame('👑 WEALTH', [
        `🌐 ACCOUNTS: ${stats.accounts}`,
        `💰 TOTAL CIRCULATION: ${stats.total}`,
        `🩸 YOUR WEALTH: ${account?.balance ?? 0}`,
        top ? `⚡ WEALTHIEST SOUL: @${top.user_jid.split('@')[0]} — ${top.balance}` : '⚡ NO WEALTHIEST SOUL YET',
      ]),
    );
  },
};
