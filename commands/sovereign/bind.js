import { CommandError } from '../../lib/helpers.js';
import { bindUser, listBoundUsers, resolveOperatorTarget, unbindUser } from './_operators.js';

const LEGACY_NAMES = new Set(['sudo', 'edictor', 'operators']);

export default {
  name: 'bind',
  aliases: ['sudo', 'edictor', 'operators'],
  description: 'Bind a soul as a sudo user, or list every bound user.',
  category: 'sovereign',
  usage: 'bind <@user|list>',
  permissions: ['owner'],
  cooldownMs: 2000,
  async execute(ctx) {
    const invoked = String(ctx.commandName || ctx.command?.name || 'bind').toLowerCase();
    const first = String(ctx.args[0] || '').toLowerCase();

    if (LEGACY_NAMES.has(invoked)) {
      const action = first || 'list';
      if (action === 'list') {
        await listBoundUsers(ctx);
        return;
      }
      if (action === 'add') {
        await bindUser(ctx, resolveOperatorTarget(ctx, 1));
        return;
      }
      if (action === 'remove') {
        await unbindUser(ctx, resolveOperatorTarget(ctx, 1));
        return;
      }
      throw new CommandError(
        `Use ${ctx.prefix}bind @user, ${ctx.prefix}bind list, or ${ctx.prefix}unbind @user.`,
      );
    }

    if (first === 'list') {
      await listBoundUsers(ctx);
      return;
    }

    if (!first && !ctx.targetJid) {
      throw new CommandError(`Use ${ctx.prefix}bind @user or ${ctx.prefix}bind list.`);
    }

    const argIndex = first === 'add' ? 1 : 0;
    await bindUser(ctx, resolveOperatorTarget(ctx, argIndex));
  },
};
