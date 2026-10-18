import { fullFrame } from '../../lib/formatter.js';
import { formatDuration, nowSeconds } from '../../lib/helpers.js';

const CLAIMS = [
  { field: 'last_daily', label: 'TRIBUTE', cooldown: 86400 },
  { field: 'last_work', label: 'LABOR', cooldown: 3600 },
  { field: 'last_mine', label: 'EXCAVATION', cooldown: 1800 },
];

export default {
  name: 'treasury',
  aliases: ['balance', 'wallet'],
  description: 'Read your treasury and the seals on your earning rites.',
  category: 'economy',
  usage: 'treasury',
  permissions: ['public'],
  cooldownMs: 3000,
  async execute(ctx) {
    const account = ctx.db.ensureEconomy(ctx.senderJid);
    const ranking = ctx.db.topBalances(50);
    const position = ranking.findIndex((entry) => entry.user_jid === ctx.senderJid) + 1;
    const now = nowSeconds();

    const lines = [
      `🩸 SOUL: @${ctx.senderJid.split('@')[0]}`,
      `👑 WEALTH: ${account.balance}`,
      `⛓ RANK: ${position ? `${position} / ${ranking.length}` : 'outside the top 50'}`,
      '',
      '【 RITES 】',
    ];
    for (const claim of CLAIMS) {
      const last = Number(account[claim.field]) || 0;
      const remaining = last + claim.cooldown - now;
      lines.push(
        remaining > 0
          ? `▸ ${claim.label}: sealed for ${formatDuration(remaining * 1000)}`
          : `▸ ${claim.label}: ready`,
      );
    }

    await ctx.reply(fullFrame('💰 TREASURY', lines), { mentions: [ctx.senderJid] });
  },
};
