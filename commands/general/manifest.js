import { fullFrame } from '../../lib/formatter.js';
import { formatBytes, formatDuration } from '../../lib/helpers.js';

export default {
  name: 'manifest',
  aliases: ['info', 'about'],
  description: 'Reveal the identity and law of ΠΣXUS CΩRΣ.',
  category: 'general',
  usage: 'manifest',
  permissions: ['public'],
  cooldownMs: 3000,
  async execute(ctx) {
    const stats = ctx.db.stats();
    await ctx.reply(
      fullFrame('👹 THE KING\'S MANIFEST', [
        `🔥 NAME: ${ctx.config.botName}`,
        `👑 OWNER: ${ctx.config.ownerDisplay}`,
        `⚡ PREFIX: ${ctx.prefix}`,
        `🩸 VERSION: ${ctx.config.version}`,
        `⛓ BAILEYS: ${ctx.config.baileysVersion}`,
        `🧿 RUNTIME: Node ${process.version} | ${formatBytes(process.memoryUsage().rss)} RSS | ${formatDuration(process.uptime() * 1000)}`,
        `👁 BOUND CURSES: ${ctx.registry.size}`,
        `🌐 DOMAINS TRACKED: ${stats.groups}`,
        `🦴 SOULS TRACKED: ${stats.users}`,
        '',
        `> ${ctx.config.shrine.slogan}`,
      ]),
    );
  },
};
