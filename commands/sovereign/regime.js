import { fullFrame } from '../../lib/formatter.js';
import { CommandError } from '../../lib/helpers.js';

function validPrefix(value) {
  const prefix = String(value || '').trim();
  if (!prefix || prefix.length > 3 || /\s/.test(prefix)) {
    throw new CommandError('A prefix must be 1-3 non-space characters.');
  }
  return prefix;
}

export default {
  name: 'regime',
  aliases: ['realm'],
  description: 'Inspect or rewrite the global law of the vessel.',
  category: 'sovereign',
  usage: 'regime [status|prefix <value>|prefix reset]',
  permissions: ['owner'],
  cooldownMs: 2000,
  async execute(ctx) {
    const action = (ctx.args[0] || 'status').toLowerCase();

    if (action === 'status') {
      const stats = ctx.db.stats();
      const globalPrefix = ctx.db.getSetting('prefix', ctx.config.prefix);
      await ctx.reply(
        fullFrame('☥ REGIME', [
          `👑 SOVEREIGN: ${ctx.config.ownerDisplay}`,
          `⚡ GLOBAL PREFIX: ${globalPrefix}`,
          `🌐 DOMAINS: ${stats.groups}`,
          `🦴 SOULS: ${stats.users}`,
          `👁 OPERATORS: ${stats.operators}`,
          `🚫 GLOBAL EXILES: ${stats.globalBans}`,
          `🌑 ABSENCE: ${ctx.db.getSettingBool('absence_enabled', false) ? 'ACTIVE' : 'DORMANT'}`,
          '',
          `> ${ctx.config.shrine.slogan}`,
        ]),
      );
      return;
    }

    if (action === 'prefix') {
      if ((ctx.args[1] || '').toLowerCase() === 'reset') {
        ctx.db.deleteSetting('prefix');
        ctx.db.logAudit(ctx.senderJid, 'regime-prefix-reset');
        await ctx.reply(fullFrame('⚡ REGIME', ['The global prefix returned to its default.']));
        return;
      }
      const prefix = validPrefix(ctx.args[1]);
      ctx.db.setSetting('prefix', prefix);
      ctx.db.logAudit(ctx.senderJid, 'regime-prefix', null, prefix);
      await ctx.reply(
        fullFrame('⚡ REGIME', [
          `🩸 GLOBAL PREFIX: ${prefix}`,
          'Domains with their own prefix override this law.',
        ]),
      );
      return;
    }

    throw new CommandError('Use status, prefix <value> or prefix reset.');
  },
};
