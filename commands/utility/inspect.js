import { fullFrame } from '../../lib/formatter.js';
import { formatTimestamp, normalizeJid } from '../../lib/helpers.js';
import { isGroupAdmin } from '../../lib/permissions.js';

export default {
  name: 'inspect',
  aliases: ['identity'],
  description: 'Inspect a soul\'s real identity, rank and standing in this domain.',
  category: 'utility',
  usage: 'inspect [@user]',
  permissions: ['public'],
  cooldownMs: 3000,
  async execute(ctx) {
    const target = ctx.targetJid || ctx.senderJid;
    const stats = ctx.db.getUserStats(target);
    const account = ctx.db.getEconomy(target);
    const groupWarnings = ctx.isGroup ? ctx.db.countWarnings(ctx.chatJid, target) : 0;
    const participant = ctx.groupMeta?.participants?.find(
      (entry) => normalizeJid(entry.id) === normalizeJid(target),
    );

    await ctx.reply(
      fullFrame('👁 INSPECTION', [
        `🩸 SOUL: @${target.split('@')[0]}`,
        `⛓ JID: ${target}`,
        `👑 DOMAIN ADMIN: ${ctx.isGroup ? (isGroupAdmin(ctx.groupMeta, target) ? 'YES' : 'NO') : 'n/a'}`,
        participant?.admin ? `⚡ ADMIN RANK: ${String(participant.admin).toUpperCase()}` : null,
        `🩸 NEXUS OPERATOR: ${ctx.db.isOperator(target) ? 'YES' : 'NO'}`,
        ctx.isGroup ? `🤝 DOMAIN ALLY: ${ctx.db.isAlly(ctx.chatJid, target) ? 'YES' : 'NO'}` : null,
        ctx.isGroup ? `🚫 DOMAIN EXILE: ${ctx.db.isBannedFromGroup(ctx.chatJid, target) ? 'YES' : 'NO'}` : null,
        `☠️ GLOBAL EXILE: ${ctx.db.isGloballyBanned(target) ? 'YES' : 'NO'}`,
        `⛓ WARNINGS HERE: ${groupWarnings}`,
        `🩸 WARNINGS TOTAL: ${stats.warnings}`,
        `💰 CURSED WEALTH: ${account?.balance ?? 0}`,
        `👁 FIRST SEEN: ${stats.firstSeen ? formatTimestamp(stats.firstSeen, { locale: ctx.config.locale, timezone: ctx.config.timezone }) : 'unknown'}`,
        `⏳ LAST SEEN: ${stats.lastSeen ? formatTimestamp(stats.lastSeen, { locale: ctx.config.locale, timezone: ctx.config.timezone }) : 'unknown'}`,
      ]),
      { mentions: [target] },
    );
  },
};
