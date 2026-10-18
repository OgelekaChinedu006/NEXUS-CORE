import { fullFrame, compactFrame } from '../../lib/formatter.js';
import { formatDuration, nowSeconds, randomInt } from '../../lib/helpers.js';

const COOLDOWN_SECONDS = 86400;

export default {
  name: 'tribute',
  aliases: ['daily'],
  description: 'Collect the once-a-day tribute owed to your soul.',
  category: 'economy',
  usage: 'tribute',
  permissions: ['public'],
  cooldownMs: 5000,
  async execute(ctx) {
    const amount = randomInt(120, 280);
    const now = nowSeconds();
    const result = ctx.db.claimEconomy(ctx.senderJid, 'last_daily', COOLDOWN_SECONDS, amount, now);
    if (!result.claimed) {
      await ctx.reply(
        compactFrame('💰 TRIBUTE SEALED', [
          `The tribute was already claimed. It returns in ${formatDuration((result.nextAt - now) * 1000)}.`,
          `WEALTH: ${result.balance}`,
        ]),
      );
      return;
    }

    await ctx.reply(
      fullFrame('💰 TRIBUTE CLAIMED', [
        `🩸 TRIBUTE: +${amount}`,
        `👑 WEALTH: ${result.balance}`,
        'The domain feeds those who remember it.',
      ]),
    );
  },
};
