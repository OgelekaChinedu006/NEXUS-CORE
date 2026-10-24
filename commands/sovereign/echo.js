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
    const mode = parseEchoMode(ctx.args[0]);
    if (!mode) throw new CommandError(ECHO_USAGE);
    if (mode === 'soul') resolveOwnerDestination(ctx);
    const recovered = await recoverViewedStatus(ctx);
    await deliverEcho(ctx, mode, recovered);
  },
};
