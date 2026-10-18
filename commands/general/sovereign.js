import { fullFrame } from '../../lib/formatter.js';

export default {
  name: 'sovereign',
  aliases: ['owner'],
  description: 'Acknowledge the Sovereign who owns this vessel.',
  category: 'general',
  usage: 'sovereign',
  permissions: ['public'],
  cooldownMs: 5000,
  async execute(ctx) {
    await ctx.reply(
      fullFrame('☥ THE SOVEREIGN', [
        `👑 THRONE: ${ctx.config.ownerDisplay}`,
        '🩸 AUTHORITY: absolute over this vessel',
        '⚡ JID VERIFICATION: configured server-side; display names are never trusted',
        '⛓ DIRECT CONTACT: use the owner\'s verified WhatsApp identity only',
        '',
        '> The King does not negotiate with echoes.',
      ]),
    );
  },
};
