import { CommandError } from '../../lib/helpers.js';
import {
  HORUS_ERASE_SETTING,
  HORUS_VANISH_SETTING,
  readHorusState,
  renderHorusMenu,
  renderHorusStatus,
  setHorusJoint,
  setHorusWatch,
} from '../../lib/horus.js';

function replyState(ctx, extra) {
  const state = readHorusState(ctx.db, ctx.config);
  const body = extra ? `${extra}\n${renderHorusMenu(state)}` : renderHorusMenu(state);
  return ctx.reply(body);
}

export default {
  name: 'horus',
  aliases: [],
  description: 'Control Vanishing Watch and Erasure Watch for the Sovereign owner DM.',
  category: 'sovereign',
  usage: 'horus [status|vanish on|vanish off|erase on|erase off|joint on|joint off]',
  permissions: ['owner'],
  cooldownMs: 2000,
  async execute(ctx) {
    const action = (ctx.args[0] || '').toLowerCase();
    const toggle = (ctx.args[1] || '').toLowerCase();

    if (!action || action === 'menu') {
      await ctx.reply(renderHorusMenu(readHorusState(ctx.db, ctx.config)));
      return;
    }

    if (action === 'status') {
      await ctx.reply(renderHorusStatus(readHorusState(ctx.db, ctx.config)));
      return;
    }

    if (action === 'vanish' || action === 'erase' || action === 'joint') {
      if (toggle !== 'on' && toggle !== 'off') {
        throw new CommandError(`Use ${ctx.prefix}horus ${action} on|off.`);
      }
      const enabled = toggle === 'on';
      if (action === 'joint') {
        setHorusJoint(ctx.db, enabled);
        ctx.db.logAudit(ctx.senderJid, 'horus-joint', null, toggle);
        await replyState(ctx, enabled ? 'Both watches enabled.' : 'Both watches disabled.');
        return;
      }
      const key = action === 'vanish' ? HORUS_VANISH_SETTING : HORUS_ERASE_SETTING;
      setHorusWatch(ctx.db, key, enabled);
      ctx.db.logAudit(ctx.senderJid, `horus-${action}`, null, toggle);
      await replyState(
        ctx,
        `${action === 'vanish' ? 'Vanishing Watch' : 'Erasure Watch'}: ${enabled ? 'ON' : 'OFF'}`,
      );
      return;
    }

    throw new CommandError(
      'Use status, vanish on|off, erase on|off or joint on|off.',
    );
  },
};
