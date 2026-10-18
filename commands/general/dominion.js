import { fullFrame } from '../../lib/formatter.js';
import { formatDuration } from '../../lib/helpers.js';

export default {
  name: 'dominion',
  aliases: ['botstats'],
  description: 'Count the souls, domains and judgments under the King.',
  category: 'general',
  usage: 'dominion',
  permissions: ['public'],
  cooldownMs: 5000,
  async execute(ctx) {
    const stats = ctx.db.stats();
    const economy = ctx.db.economyStats();
    await ctx.reply(
      fullFrame('👁 DOMINION LEDGER', [
        `🌐 DOMAINS TRACKED: ${stats.groups}`,
        `🦴 SOULS TRACKED: ${stats.users}`,
        `🩸 MESSAGES WITNESSED: ${stats.messages}`,
        `⚡ CURSES EXECUTED: ${stats.commands}`,
        `⛓ WARNINGS: ${stats.warnings}`,
        `☠️ MODERATION RECORDS: ${stats.moderation}`,
        `👑 OPERATORS: ${stats.operators}`,
        `🚫 GLOBAL BANS: ${stats.globalBans}`,
        `🔒 DOMAIN EXILES: ${stats.groupBans}`,
        `💰 CURSED WEALTH: ${economy.total} across ${economy.accounts} souls`,
        `⏳ VESSEL AWAKE: ${formatDuration(process.uptime() * 1000)}`,
      ]),
    );
  },
};
