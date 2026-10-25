import { fullFrame } from '../../lib/formatter.js';
import { sanitizeField } from '../../lib/helpers.js';

export default {
  name: 'farewell',
  aliases: ['setgoodbye'],
  description: 'Inscribe the departure rite template for leaving souls.',
  category: 'security',
  usage: 'farewell <text|reset>',
  permissions: ['admin'],
  async execute(ctx) {
    const raw = ctx.argsText;
    if (!raw) {
      await ctx.reply(
        fullFrame('🖋 FAREWELL', [
          'Provide the departure text, or use reset to restore the King\'s default.',
          'Placeholders: {user} {group} {count} {rules} {time}',
        ]),
      );
      return;
    }

    if (raw.toLowerCase() === 'reset') {
      ctx.db.updateGroup(ctx.chatJid, { goodbye_text: null, goodbye_enabled: 1 });
      await ctx.reply(fullFrame('🖋 RITE RESTORED', ['The default departure rite is bound again.']));
      return;
    }

    const template = sanitizeField(raw, 2000);
    ctx.db.updateGroup(ctx.chatJid, { goodbye_text: template, goodbye_enabled: 1 });
    await ctx.reply(
      fullFrame('🖋 FAREWELL INSCRIBED', [
        '🩸 The departure rite has been rewritten and activated.',
        template.includes('{user}')
          ? 'The leaving soul will be mentioned through {user}.'
          : 'Warning: {user} is absent. The rite will not mention the leaving soul.',
      ]),
    );
  },
};
