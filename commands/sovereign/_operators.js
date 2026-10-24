import { CommandError, normalizeJid, toUserJid } from '../../lib/helpers.js';
import { fullFrame } from '../../lib/formatter.js';

export function resolveOperatorTarget(ctx, argIndex = 0) {
  const candidate = ctx.targetJid || toUserJid(ctx.args[argIndex]);
  const target = normalizeJid(candidate);
  if (!target) throw new CommandError('Mention a soul, reply to them, or pass their WhatsApp JID.');
  return target;
}

export function assertBindable(ctx, target) {
  if (target === normalizeJid(ctx.botJid)) {
    throw new CommandError('The vessel cannot be bound to itself.');
  }
  if (target === normalizeJid(ctx.config.ownerJid)) {
    throw new CommandError('The Sovereign already owns this vessel.');
  }
}

export async function listBoundUsers(ctx) {
  const operators = ctx.db.listOperators();
  if (!operators.length) {
    await ctx.reply(fullFrame('👁 BOUND USERS', ['No souls are bound to the vessel.']));
    return;
  }
  await ctx.reply(
    fullFrame('👁 BOUND USERS', [
      ...operators.map(
        (operator) =>
          `▸ @${operator.user_jid.split('@')[0]} — bound ${new Date(operator.created_at * 1000).toISOString().slice(0, 10)}`,
      ),
    ]),
    { mentions: operators.map((operator) => operator.user_jid) },
  );
}

export async function bindUser(ctx, target) {
  assertBindable(ctx, target);
  if (ctx.db.isOperator(target)) {
    await ctx.reply(fullFrame('👁 BOUND USERS', ['That soul is already bound.']));
    return;
  }
  ctx.db.addOperator(target, ctx.senderJid);
  ctx.db.logAudit(ctx.senderJid, 'operator-add', target);
  await ctx.reply(
    fullFrame('👁 USER BOUND', [
      `🩸 SOUL: @${target.split('@')[0]}`,
      '⚡ Bound authority granted. The King will remember this choice.',
    ]),
    { mentions: [target] },
  );
}

export async function unbindUser(ctx, target) {
  if (!ctx.db.isOperator(target)) {
    await ctx.reply(fullFrame('👁 BOUND USERS', ['That soul is not bound.']));
    return;
  }
  ctx.db.removeOperator(target);
  ctx.db.logAudit(ctx.senderJid, 'operator-remove', target);
  await ctx.reply(
    fullFrame('👁 USER UNBOUND', [
      `🩸 SOUL: @${target.split('@')[0]}`,
      'Bound authority has been stripped.',
    ]),
    { mentions: [target] },
  );
}
