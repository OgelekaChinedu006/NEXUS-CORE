import { compactFrame } from '../../lib/formatter.js';
import { formatDuration } from '../../lib/helpers.js';

export default {
  name: 'eternity',
  aliases: ['uptime'],
  description: 'Measure how long the vessel has endured.',
  category: 'general',
  usage: 'eternity',
  permissions: ['public'],
  cooldownMs: 3000,
  async execute(ctx) {
    await ctx.reply(
      compactFrame('⏳ ETERNITY', [
        `VESSEL AWAKE: ${formatDuration(process.uptime() * 1000)}`,
        `SESSION BOUND: ${ctx.connection?.uptimeMs ? formatDuration(ctx.connection.uptimeMs) : 'not connected'}`,
      ]),
    );
  },
};
