import { compactFrame } from '../../lib/formatter.js';
import { formatBytes, formatDuration } from '../../lib/helpers.js';

export default {
  name: 'vessel',
  aliases: ['diagnostics'],
  description: 'Inspect the vessel\'s body, memory and bindings.',
  category: 'general',
  usage: 'vessel',
  permissions: ['public'],
  cooldownMs: 5000,
  async execute(ctx) {
    const started = Date.now();
    let dbState = 'error';
    try {
      dbState = ctx.db.ping() ? `nominal (${Date.now() - started}ms)` : 'error';
    } catch {
      dbState = 'error';
    }
    const memory = process.memoryUsage();
    await ctx.reply(
      compactFrame('🧿 VESSEL DIAGNOSTICS', [
        `CORE: ${ctx.config.botName} v${ctx.config.version}`,
        `BAILEYS: ${ctx.config.baileysVersion}`,
        `NODE: ${process.version}`,
        `STATE: ${(ctx.connection?.state || 'unknown').toUpperCase()}`,
        `DB: ${dbState}`,
        `MEMORY: ${formatBytes(memory.rss)} RSS / ${formatBytes(memory.heapUsed)} heap`,
        `UPTIME: ${formatDuration(process.uptime() * 1000)}`,
        `AUTH: persistent session ${ctx.connection?.state === 'open' ? 'bound' : 'unbound'}`,
        `CURSES: ${ctx.registry.size}`,
      ]),
    );
  },
};
