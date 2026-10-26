import { fullFrame } from '../../lib/formatter.js';
import { executeRuneCommand } from '../../lib/rune-commands.js';
import { applyBotLockdown } from '../../lib/rune-engine.js';
import { resolveRuneSetting } from '../../lib/runes.js';

export default {
  name: 'botrune',
  aliases: ['botward'],
  description: 'Configure the Bot Rune: Lockdown or Crush Zone.',
  category: 'atlas-rune',
  usage: 'botrune [on|off|lockdown|crush|status|help]',
  permissions: ['admin'],
  cooldownMs: 2000,
  async execute(ctx) {
    const result = await executeRuneCommand(ctx, 'bot');
    const setting = result?.setting || resolveRuneSetting(ctx.db, ctx.chatJid, 'bot');
    const switchedToLockdown = Boolean(
      result?.patched &&
        setting.enabled &&
        setting.mode === 'lockdown' &&
        (result.patch?.enabled === true || result.patch?.mode === 'lockdown'),
    );
    if (!switchedToLockdown) return;
    const lockdown = await applyBotLockdown({
      sock: ctx.sock,
      groupJid: ctx.chatJid,
      db: ctx.db,
      actorJid: ctx.senderJid,
      logger: ctx.logger,
    });
    if (!lockdown.ok) {
      await ctx.reply(fullFrame('⚠️ BOT RUNE', [
        'Lockdown restrictions were requested. Members were not removed.',
        ...lockdown.failures.map((entry) => `▸ ${entry}`),
      ]));
    }
  },
};
