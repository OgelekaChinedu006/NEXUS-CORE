import { fullFrame } from '../../lib/formatter.js';
import { isBotAdmin } from '../../lib/permissions.js';
import { describeRuneSetting, resolveRuneSetting } from '../../lib/runes.js';

export default {
  name: 'vigil',
  aliases: ['security'],
  description: 'Survey every active ward and warning in the domain.',
  category: 'security',
  usage: 'vigil',
  permissions: ['admin'],
  cooldownMs: 3000,
  async execute(ctx) {
    const warnings = ctx.db.listWarnings(ctx.chatJid, null, 100);
    const uniqueTargets = new Set(warnings.map((warning) => warning.user_jid)).size;
    const linkRune = resolveRuneSetting(ctx.db, ctx.chatJid, 'link');
    const spamRune = resolveRuneSetting(ctx.db, ctx.chatJid, 'spam');
    const mentionRune = resolveRuneSetting(ctx.db, ctx.chatJid, 'mention');
    const botRune = resolveRuneSetting(ctx.db, ctx.chatJid, 'bot');
    await ctx.reply(
      fullFrame('👁 VIGIL', [
        `🕸 ANTI-LINK: ${ctx.group?.antilink ? 'ACTIVE' : 'DORMANT'}`,
        `🧿 LINK RUNE: ${describeRuneSetting(linkRune)}`,
        `🩸 PROFANITY WARD: ${ctx.group?.profanity ? 'ACTIVE' : 'DORMANT'}`,
        `🌊 ANTI-FLOOD: ${ctx.group?.antispam ? 'ACTIVE' : 'DORMANT'}`,
        `🧿 SPAM RUNE: ${describeRuneSetting(spamRune)}`,
        `🧿 MENTION RUNE: ${describeRuneSetting(mentionRune)}`,
        `🧿 BOT RUNE: ${describeRuneSetting(botRune)}`,
        `🔐 COMMAND SEAL: ${ctx.group?.sealed ? 'ACTIVE' : 'BROKEN'}`,
        `👑 BOT ADMIN: ${isBotAdmin(ctx.groupMeta, ctx.botJid) ? 'YES' : 'NO'}`,
        `⛓ WARNING LIMIT: ${ctx.group?.max_warnings || 3}`,
        `🩸 ACTIVE WARNING MARKS: ${warnings.length}`,
        `👁 MARKED SOULS: ${uniqueTargets}`,
        `🚪 WELCOME RITE: ${ctx.group?.welcome_enabled ? 'ACTIVE' : 'DORMANT'}`,
        `☠️ DEPARTURE RITE: ${ctx.group?.goodbye_enabled ? 'ACTIVE' : 'DORMANT'}`,
      ]),
    );
  },
};
