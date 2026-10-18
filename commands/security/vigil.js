import { fullFrame } from '../../lib/formatter.js';
import { isBotAdmin } from '../../lib/permissions.js';

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
    await ctx.reply(
      fullFrame('👁 VIGIL', [
        `🕸 ANTI-LINK: ${ctx.group?.antilink ? 'ACTIVE' : 'DORMANT'}`,
        `🩸 PROFANITY WARD: ${ctx.group?.profanity ? 'ACTIVE' : 'DORMANT'}`,
        `🌊 ANTI-FLOOD: ${ctx.group?.antispam ? 'ACTIVE' : 'DORMANT'}`,
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
