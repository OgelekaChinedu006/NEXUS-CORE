import { fullFrame } from '../../lib/formatter.js';
import { CommandError, sanitizeField } from '../../lib/helpers.js';

const DEFAULT_ABSENCE_MESSAGE =
  'ΠΣXUS CΩRΣ is absent from the domain. Do not mistake silence for weakness.';

export default {
  name: 'absence',
  aliases: ['vanish'],
  description: 'Silence the vessel for everyone except the Sovereign and operators.',
  category: 'sovereign',
  usage: 'absence [status|on|off|message <text>|reset]',
  permissions: ['owner'],
  cooldownMs: 2000,
  async execute(ctx) {
    const action = (ctx.args[0] || 'status').toLowerCase();

    if (action === 'status') {
      const active = ctx.db.getSettingBool('absence_enabled', false);
      const message = ctx.db.getSetting('absence_message', DEFAULT_ABSENCE_MESSAGE);
      await ctx.reply(
        fullFrame('🌑 ABSENCE', [
          `🩸 STATUS: ${active ? 'ACTIVE' : 'DORMANT'}`,
          `⚡ NOTICE: ${sanitizeField(message, 300)}`,
          '',
          `> ${ctx.prefix}absence on|off|message <text>|reset`,
        ]),
      );
      return;
    }

    if (action === 'on' || action === 'off') {
      const enabled = action === 'on' ? 1 : 0;
      ctx.db.setSetting('absence_enabled', enabled);
      ctx.db.logAudit(ctx.senderJid, 'absence-toggle', null, action);
      await ctx.reply(
        fullFrame('🌑 ABSENCE', [
          `🩸 STATUS: ${enabled ? 'ACTIVE' : 'DORMANT'}`,
          enabled
            ? 'Only the Sovereign and operators will be answered.'
            : 'The vessel answers its souls again.',
        ]),
      );
      return;
    }

    if (action === 'message') {
      const message = sanitizeField(ctx.args.slice(1).join(' '), 300);
      if (!message) throw new CommandError('Provide the absence notice text.');
      ctx.db.setSetting('absence_message', message);
      ctx.db.logAudit(ctx.senderJid, 'absence-message');
      await ctx.reply(fullFrame('🌑 ABSENCE', ['The absence notice has been rewritten.']));
      return;
    }

    if (action === 'reset') {
      ctx.db.deleteSetting('absence_message');
      ctx.db.setSetting('absence_enabled', 0);
      ctx.db.logAudit(ctx.senderJid, 'absence-reset');
      await ctx.reply(fullFrame('🌑 ABSENCE', ['Absence was reset to the default dormant state.']));
      return;
    }

    throw new CommandError('Use status, on, off, message <text> or reset.');
  },
};
