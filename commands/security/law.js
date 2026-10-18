import { fullFrame } from '../../lib/formatter.js';
import { sanitizeField } from '../../lib/helpers.js';

export default {
  name: 'law',
  aliases: ['rules'],
  description: 'Read or inscribe the law shown in the domain welcome rite.',
  category: 'security',
  usage: 'law [text|reset]',
  permissions: ['group', 'admin'],
  cooldownMs: 3000,
  async execute(ctx) {
    if (!ctx.argsText) {
      const law = ctx.group?.rules || ctx.groupMeta?.desc || '';
      await ctx.reply(
        fullFrame('📜 DOMAIN LAW', [
          law ? sanitizeField(law, 1200) : 'No law has been inscribed. The strong decide.',
          '',
          `> ${ctx.prefix}law <text> inscribes new law. ${ctx.prefix}law reset clears it.`,
        ]),
      );
      return;
    }

    if (ctx.argsText.toLowerCase() === 'reset') {
      ctx.db.updateGroup(ctx.chatJid, { rules: null });
      ctx.db.logModeration(ctx.chatJid, 'law-reset', null, ctx.senderJid, 'Domain law cleared');
      await ctx.reply(fullFrame('📜 DOMAIN LAW', ['The inscribed law has been cleared.']));
      return;
    }

    const law = sanitizeField(ctx.argsText, 1200);
    ctx.db.updateGroup(ctx.chatJid, { rules: law });
    ctx.db.logModeration(ctx.chatJid, 'law-set', null, ctx.senderJid, 'Domain law inscribed');
    await ctx.reply(
      fullFrame('📜 DOMAIN LAW', [
        `🩸 LAW INSCRIBED:`,
        `> ${law}`,
        '',
        'It will appear in the welcome rite as {rules}.',
      ]),
    );
  },
};
