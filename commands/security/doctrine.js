import { fullFrame } from '../../lib/formatter.js';
import { CommandError, parseAmount } from '../../lib/helpers.js';

export default {
  name: 'doctrine',
  aliases: ['warninglimit'],
  description: 'Read or rewrite the domain doctrine for warnings and banishment.',
  category: 'security',
  usage: 'doctrine [limit|reset]',
  permissions: ['group', 'admin'],
  cooldownMs: 3000,
  async execute(ctx) {
    const action = (ctx.args[0] || 'status').toLowerCase();

    if (action === 'status') {
      const limit = Number(ctx.group?.max_warnings) || 3;
      await ctx.reply(
        fullFrame('⚖️ DOCTRINE', [
          `👑 WARNING LIMIT: ${limit}`,
          `🩸 AUTO-BANISH AT: ${limit} warning(s)`,
          `⛓ BOT ADMIN: ${ctx.isBotAdmin ? 'YES' : 'NO'}`,
          'Warnings are recorded per soul and per domain.',
          '',
          `> ${ctx.prefix}doctrine <2-10> changes the limit. ${ctx.prefix}doctrine reset restores 3.`,
        ]),
      );
      return;
    }

    if (action === 'reset') {
      ctx.db.updateGroup(ctx.chatJid, { max_warnings: 3 });
      ctx.db.logModeration(ctx.chatJid, 'doctrine-reset', null, ctx.senderJid, 'Warning limit reset to 3');
      await ctx.reply(fullFrame('⚖️ DOCTRINE', ['The warning limit returned to 3.']));
      return;
    }

    const limit = parseAmount(action, { min: 2, max: 10 });
    if (!limit) throw new CommandError('The warning limit must be a whole number from 2 to 10.');
    ctx.db.updateGroup(ctx.chatJid, { max_warnings: limit });
    ctx.db.logModeration(ctx.chatJid, 'doctrine-set', null, ctx.senderJid, `Warning limit set to ${limit}`);
    await ctx.reply(
      fullFrame('⚖️ DOCTRINE', [
        `🩸 WARNING LIMIT: ${limit}`,
        `Souls reaching ${limit} warning(s) will be banished when the vessel holds admin power.`,
      ]),
    );
  },
};
