import { CommandError } from '../../lib/helpers.js';
import { resolveOperatorTarget, unbindUser } from './_operators.js';

export default {
  name: 'unbind',
  aliases: [],
  description: 'Strip bound sudo authority from a soul.',
  category: 'sovereign',
  usage: 'unbind <@user>',
  permissions: ['owner'],
  cooldownMs: 2000,
  async execute(ctx) {
    const first = String(ctx.args[0] || '').toLowerCase();
    if (!first && !ctx.targetJid) {
      throw new CommandError(`Use ${ctx.prefix}unbind @user.`);
    }
    await unbindUser(ctx, resolveOperatorTarget(ctx, 0));
  },
};
