import { fullFrame } from '../../lib/formatter.js';
import { sanitizeField } from '../../lib/helpers.js';

export default {
  name: 'inscribe',
  aliases: ['setwelcome'],
  description: 'Inscribe the welcome rite template for new souls.',
  category: 'security',
  usage: 'inscribe <text|reset>',
  permissions: ['admin'],
  async execute(ctx) {
    const raw = ctx.argsText;
    if (!raw) {
      await ctx.reply(
        fullFrame('🖋 INSCRIBE', [
          'Provide the rite text, or use reset to restore the King\'s default.',
          'Placeholders: {user} {group} {count} {rules} {time}',
        ]),
      );
      return;
    }

    if (raw.toLowerCase() === 'reset') {
      ctx.db.updateGroup(ctx.chatJid, { welcome_text: null, welcome_enabled: 1 });
      await ctx.reply(fullFrame('🖋 RITE RESTORED', ['The default incarnation rite is bound again.']));
      return;
    }

    const template = sanitizeField(raw, 2000);
    ctx.db.updateGroup(ctx.chatJid, { welcome_text: template, welcome_enabled: 1 });
    await ctx.reply(
      fullFrame('🖋 RITE INSCRIBED', [
        '🩸 The welcome rite has been rewritten and activated.',
        template.includes('{user}')
          ? 'The new soul will be mentioned through {user}.'
          : 'Warning: {user} is absent. The rite will not mention the new soul.',
      ]),
    );
  },
};
