import { compactFrame } from '../../lib/formatter.js';
import { formatDuration } from '../../lib/helpers.js';

export default {
  name: 'pulse',
  aliases: ['ping'],
  description: 'Check the vessel\'s heartbeat, latency and connection state.',
  category: 'general',
  usage: 'pulse',
  permissions: ['public'],
  cooldownMs: 1000,
  async execute(ctx) {
    const started = Date.now();
    let dbLatency = 'offline';
    try {
      if (ctx.db.ping()) dbLatency = `${Date.now() - started}ms`;
    } catch {
      dbLatency = 'error';
    }
    const connectionState = ctx.connection?.state || 'unknown';
    const connectedFor = ctx.connection?.uptimeMs || 0;

    await ctx.reply(
      compactFrame('⚡ VESSEL PULSE', [
        `STATE: ${connectionState.toUpperCase()}`,
        `DB LATENCY: ${dbLatency}`,
        `PROCESS UPTIME: ${formatDuration(process.uptime() * 1000)}`,
        `SESSION UPTIME: ${connectedFor ? formatDuration(connectedFor) : 'not connected'}`,
        `BOUND CURSES: ${ctx.registry.size}`,
      ]),
    );
  },
};
