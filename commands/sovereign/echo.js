import { fullFrame } from '../../lib/formatter.js';
import { CommandError } from '../../lib/helpers.js';
import {
  ECHO_USAGE,
  deliverEcho,
  parseEchoMode,
  recoverViewedStatus,
  resolveOwnerDestination,
} from '../../lib/status-echo.js';

export default {
  name: 'echo',
  aliases: [],
  description: 'Retrieve a viewed WhatsApp status into the owner DM or the current chat.',
  category: 'sovereign',
  usage: 'echo <soul|realm>',
  permissions: ['owner'],
  cooldownMs: 3000,
  timeoutMs: 45000,
  async execute(ctx) {
    const requested = String(ctx.args[0] || '').trim().toLowerCase();
    if (!requested) {
      await ctx.reply(
        fullFrame('☥ ECHO', [
          'Retrieve a viewed status. Quoted first; otherwise the latest cached view.',
          '',
          `▸ SOUL — send it to the Sovereign's private DM.`,
          `▸ REALM — send it to this chat.`,
          '',
          `> ${ctx.prefix}echo soul`,
          `> ${ctx.prefix}echo realm`,
        ]),
      );
      return;
    }

    const mode = parseEchoMode(requested);
    if (!mode) throw new CommandError(ECHO_USAGE);
    if (mode === 'soul') resolveOwnerDestination(ctx);
    const recovered = await recoverViewedStatus(ctx);
    await deliverEcho(ctx, mode, recovered);
  },
};
