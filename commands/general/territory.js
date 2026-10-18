import { fullFrame } from '../../lib/formatter.js';
import { formatTimestamp, truncate } from '../../lib/helpers.js';
import { isBotAdmin, isGroupAdmin } from '../../lib/permissions.js';

export default {
  name: 'territory',
  aliases: ['groupinfo'],
  description: 'Survey the current domain: throne, wards and population.',
  category: 'general',
  usage: 'territory',
  permissions: ['group'],
  cooldownMs: 3000,
  async execute(ctx) {
    if (!ctx.groupMeta) {
      await ctx.reply(fullFrame('☠️ DOMAIN UNREADABLE', ['The domain metadata could not be read.']));
      return;
    }

    const meta = ctx.groupMeta;
    const participants = meta.participants || [];
    const admins = participants.filter((participant) => participant.admin);
    const protections = [
      meta.announce ? 'announcement-only' : 'open speech',
      ctx.group?.antilink ? 'anti-link' : 'links allowed',
      ctx.group?.profanity ? 'profanity ward' : 'profanity unwarded',
      ctx.group?.antispam ? 'anti-flood' : 'flood unwarded',
      ctx.group?.sealed ? 'sealed commands' : 'commands open',
    ];

    await ctx.reply(
      fullFrame('🏯 TERRITORY', [
        `👑 NAME: ${truncate(meta.subject || 'unnamed domain', 100)}`,
        `🩸 POPULATION: ${meta.size ?? participants.length}`,
        `⛓ ADMINS: ${admins.length}`,
        `⚡ CREATED: ${meta.creation ? formatTimestamp(meta.creation, { locale: ctx.config.locale, timezone: ctx.config.timezone }) : 'unknown'}`,
        `🧿 BOT ADMIN: ${isBotAdmin(meta, ctx.botJid) ? 'YES' : 'NO'}`,
        `👁 YOU ARE ADMIN: ${isGroupAdmin(meta, ctx.senderJid) ? 'YES' : 'NO'}`,
        `🔱 PREFIX: ${ctx.prefix}`,
        `🛡 WARDS: ${protections.join(', ')}`,
        '',
        `🩸 DOMAIN LAW:`,
        `> ${truncate(meta.desc || ctx.group?.rules || 'No law has been inscribed.', 600)}`,
      ]),
    );
  },
};
