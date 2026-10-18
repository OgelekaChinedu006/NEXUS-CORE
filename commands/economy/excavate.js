import { fullFrame, compactFrame } from '../../lib/formatter.js';
import { formatDuration, nowSeconds, randomInt } from '../../lib/helpers.js';

const COOLDOWN_SECONDS = 1800;

export default {
  name: 'excavate',
  aliases: ['mine'],
  description: 'Tear wealth from the buried bones of the domain.',
  category: 'economy',
  usage: 'excavate',
  permissions: ['public'],
  cooldownMs: 5000,
  async execute(ctx) {
    const amount = randomInt(15, 100);
    const now = nowSeconds();
    const result = ctx.db.claimEconomy(ctx.senderJid, 'last_mine', COOLDOWN_SECONDS, amount, now);
    if (!result.claimed) {
      await ctx.reply(
        compactFrame('🪦 EXCAVATION SEALED', [
          `The ground must heal. Excavation returns in ${formatDuration((result.nextAt - now) * 1000)}.`,
          `WEALTH: ${result.balance}`,
        ]),
      );
      return;
    }

    await ctx.reply(
      fullFrame('🪦 EXCAVATION', [
        `🩸 RECOVERED: +${amount}`,
        `👑 WEALTH: ${result.balance}`,
        'The dead do not protest.',
      ]),
    );
  },
};
