import { fullFrame } from '../../lib/formatter.js';
import { CommandError } from '../../lib/helpers.js';

export default {
  name: 'reawaken',
  aliases: ['restart'],
  description: 'Tear down and rebuild the WhatsApp socket without duplicating it.',
  category: 'sovereign',
  usage: 'reawaken',
  permissions: ['owner'],
  cooldownMs: 30000,
  async execute(ctx) {
    if (!ctx.connection?.restart) {
      throw new CommandError('The connection manager is not available.');
    }
    if (ctx.connection.starting) {
      throw new CommandError('The vessel is already reconnecting. Wait for it to settle.');
    }

    await ctx.reply(
      fullFrame('☠️ REAWAKENING', [
        '🩸 The current socket will be severed.',
        '⚡ A single fresh vessel will take its place.',
        '⛓ The session credentials remain bound.',
      ]),
    );

    setTimeout(() => {
      ctx.connection.restart().catch((error) => {
        ctx.logger.error(`Reawaken failed: ${error.message}`);
      });
    }, 750).unref?.();
  },
};
