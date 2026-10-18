import { fullFrame } from '../../lib/formatter.js';
import { CommandError, normalizeJid, toUserJid } from '../../lib/helpers.js';

function resolveTarget(ctx) {
  const candidate = ctx.targetJid || toUserJid(ctx.args[1]);
  const target = normalizeJid(candidate);
  if (!target) throw new CommandError('Mention a soul, reply to them, or pass their WhatsApp JID.');
  if (target === normalizeJid(ctx.botJid)) throw new CommandError('The vessel cannot be an operator of itself.');
  if (target === normalizeJid(ctx.config.ownerJid)) {
    throw new CommandError('The Sovereign already owns this vessel.');
  }
  return target;
}

export default {
  name: 'edictor',
  aliases: ['operators', 'sudo'],
  description: 'Appoint or remove NEXUS operators who wield sudo authority.',
  category: 'sovereign',
  usage: 'edictor <list|add|remove> [@user|jid]',
  permissions: ['owner'],
  cooldownMs: 2000,
  async execute(ctx) {
    const action = (ctx.args[0] || 'list').toLowerCase();

    if (action === 'list') {
      const operators = ctx.db.listOperators();
      if (!operators.length) {
        await ctx.reply(fullFrame('👁 OPERATORS', ['No operators are bound to the vessel.']));
        return;
      }
      await ctx.reply(
        fullFrame('👁 OPERATORS', [
          ...operators.map(
            (operator) =>
              `▸ @${operator.user_jid.split('@')[0]} — appointed ${new Date(operator.created_at * 1000).toISOString().slice(0, 10)}`,
          ),
        ]),
        { mentions: operators.map((operator) => operator.user_jid) },
      );
      return;
    }

    if (action !== 'add' && action !== 'remove') {
      throw new CommandError('Use list, add <@user> or remove <@user>.');
    }

    const target = resolveTarget(ctx);
    if (action === 'add') {
      if (ctx.db.isOperator(target)) {
        await ctx.reply(fullFrame('👁 OPERATORS', ['That soul already holds sudo authority.']));
        return;
      }
      ctx.db.addOperator(target, ctx.senderJid);
      ctx.db.logAudit(ctx.senderJid, 'operator-add', target);
      await ctx.reply(
        fullFrame('👁 OPERATOR BOUND', [
          `🩸 SOUL: @${target.split('@')[0]}`,
          '⚡ Sudo authority granted. The King will remember this choice.',
        ]),
        { mentions: [target] },
      );
      return;
    }

    if (!ctx.db.isOperator(target)) {
      await ctx.reply(fullFrame('👁 OPERATORS', ['That soul is not an operator.']));
      return;
    }
    ctx.db.removeOperator(target);
    ctx.db.logAudit(ctx.senderJid, 'operator-remove', target);
    await ctx.reply(
      fullFrame('👁 OPERATOR RELEASED', [
        `🩸 SOUL: @${target.split('@')[0]}`,
        'The sudo authority has been stripped.',
      ]),
      { mentions: [target] },
    );
  },
};
