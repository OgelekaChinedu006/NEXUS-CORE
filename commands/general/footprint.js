import { fullFrame } from '../../lib/formatter.js';
import { formatTimestamp, normalizeJid, truncate } from '../../lib/helpers.js';

export default {
  name: 'footprint',
  aliases: ['stats'],
  description: 'Inspect a soul\'s real footprint in this domain.',
  category: 'general',
  usage: 'footprint [@user]',
  permissions: ['public'],
  cooldownMs: 3000,
  async execute(ctx) {
    const target = ctx.targetJid || ctx.senderJid;
    if (!target) {
      await ctx.reply(fullFrame('☠️ NO SOUL', ['No target could be identified.']));
      return;
    }

    const stats = ctx.db.getUserStats(target);
    const account = ctx.db.getEconomy(target);
    const groupWarnings = ctx.isGroup ? ctx.db.countWarnings(ctx.chatJid, target) : 0;
    const groupActivity = ctx.isGroup
      ? ctx.db.getGroupActivity(ctx.chatJid, 50).find((row) => normalizeJid(row.user_jid) === normalizeJid(target))
      : null;

    await ctx.reply(
      fullFrame('🩸 SOUL FOOTPRINT', [
        `👁 SOUL: @${target.split('@')[0]}`,
        `🦴 MESSAGES WITNESSED: ${stats.messages}`,
        `⚡ CURSES INVOKED: ${stats.commands}`,
        `⛓ WARNINGS (ALL DOMAINS): ${stats.warnings}`,
        `🔒 WARNINGS (THIS DOMAIN): ${groupWarnings}`,
        `💰 CURSED WEALTH: ${account?.balance ?? 0}`,
        `🏯 DOMAIN MESSAGES: ${groupActivity?.messages ?? 'n/a'}`,
        `🩸 FIRST SEEN: ${stats.firstSeen ? formatTimestamp(stats.firstSeen, { locale: ctx.config.locale, timezone: ctx.config.timezone }) : 'unknown'}`,
        `⏳ LAST SEEN: ${stats.lastSeen ? formatTimestamp(stats.lastSeen, { locale: ctx.config.locale, timezone: ctx.config.timezone }) : 'unknown'}`,
        '',
        `> ${truncate(stats.messages > 100 ? 'A familiar presence. The domain remembers.' : 'The mark is faint. It can still deepen.', 160)}`,
      ], { showFooter: true }),
      { mentions: [target] },
    );
  },
};
