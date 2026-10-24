import {
  deliverToOwner,
  ownerRevealCaption,
  recoverQuotedViewOnce,
  resolveOwnerDestination,
  toSendContent,
} from '../../lib/view-once.js';

export default {
  name: 'vv2',
  aliases: [],
  description: 'Retrieve quoted view-once media into the Sovereign owner\'s private chat.',
  category: 'sovereign',
  usage: 'vv2',
  permissions: ['owner'],
  cooldownMs: 3000,
  timeoutMs: 45000,
  async execute(ctx) {
    const ownerJid = resolveOwnerDestination(ctx);
    const recovered = await recoverQuotedViewOnce(ctx);
    const caption = ownerRevealCaption(ctx, recovered);
    const content = toSendContent(recovered, {
      caption: recovered.kind === 'audio' || recovered.kind === 'voice' ? undefined : caption,
    });
    await deliverToOwner(ctx, ownerJid, content);
    if (recovered.kind === 'audio' || recovered.kind === 'voice') {
      try {
        await ctx.sock.sendMessage(ownerJid, { text: caption });
      } catch (error) {
        ctx.logger?.warn?.(`Owner view-once context notice failed: ${error.message}`);
      }
    }
  },
};
