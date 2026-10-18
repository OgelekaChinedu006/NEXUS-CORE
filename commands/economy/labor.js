import { fullFrame, compactFrame } from '../../lib/formatter.js';
import { formatDuration, nowSeconds, randomInt } from '../../lib/helpers.js';

const COOLDOWN_SECONDS = 3600;

export default {
  name: 'labor',
  aliases: ['work'],
  description: 'Sell an hour of effort to the domain for cursed wealth.',
  category: 'economy',
  usage: 'labor',
  permissions: ['public'],
  cooldownMs: 5000,
  async execute(ctx) {
    const amount = randomInt(40, 140);
    const now = nowSeconds();
    const result = ctx.db.claimEconomy(ctx.senderJid, 'last_work', COOLDOWN_SECONDS, amount, now);
    if (!result.claimed) {
      await ctx.reply(
        compactFrame('⛓ LABOR EXHAUSTED', [
          `The body needs rest. Labor returns in ${formatDuration((result.nextAt - now) * 1000)}.`,
          `WEALTH: ${result.balance}`,
        ]),
      );
      return;
    }

    await ctx.reply(
      fullFrame('⛓ LABOR COMPLETE', [
        `🩸 EARNED: +${amount}`,
        `👑 WEALTH: ${result.balance}`,
        'Effort is the only honest currency.',
      ]),
    );
  },
};
