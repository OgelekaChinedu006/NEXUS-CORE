import { fullFrame } from '../../lib/formatter.js';
import { formatTimestamp } from '../../lib/helpers.js';

export default {
  name: 'judgment',
  aliases: ['warnings'],
  description: 'Read the warning record and recent judgments of this domain.',
  category: 'security',
  usage: 'judgment [@user]',
  permissions: ['admin'],
  cooldownMs: 3000,
  async execute(ctx) {
    const target = ctx.targetJid;
    const warnings = ctx.db.listWarnings(ctx.chatJid, target, 12);
    const records = target ? [] : ctx.db.listModeration(ctx.chatJid, 8);
    const lines = [
      target ? `🩸 SOUL: @${target.split('@')[0]}` : '🩸 DOMAIN-WIDE RECORD',
      `⛓ WARNINGS: ${target ? ctx.db.countWarnings(ctx.chatJid, target) : warnings.length}`,
    ];

    if (warnings.length) {
      lines.push('', '【 WARNINGS 】');
      for (const warning of warnings) {
        lines.push(
          `▸ @${warning.user_jid.split('@')[0]} — ${warning.reason} (${formatTimestamp(warning.created_at, { locale: ctx.config.locale, timezone: ctx.config.timezone })})`,
        );
      }
    } else {
      lines.push('', 'No warnings are inscribed.');
    }

    if (records.length) {
      lines.push('', '【 RECENT JUDGMENTS 】');
      for (const record of records) {
        lines.push(
          `▸ ${record.action.toUpperCase()}${record.target_jid ? ` @${record.target_jid.split('@')[0]}` : ''} — ${record.reason || 'no reason recorded'}`,
        );
      }
    }

    await ctx.reply(fullFrame('⚖️ JUDGMENT LEDGER', lines), target ? { mentions: [target] } : {});
  },
};
