import {
  VV_SUCCESS_MESSAGE,
  deliverToChat,
  recoverQuotedViewOnce,
  toSendContent,
} from '../../lib/view-once.js';

export default {
  name: 'vv',
  aliases: [],
  description: 'Retrieve quoted view-once media into the current chat.',
  category: 'sovereign',
  usage: 'vv',
  permissions: ['owner'],
  cooldownMs: 3000,
  timeoutMs: 45000,
  async execute(ctx) {
    const recovered = await recoverQuotedViewOnce(ctx);
    await deliverToChat(ctx, toSendContent(recovered));
    try {
      await ctx.reply(VV_SUCCESS_MESSAGE);
    } catch (error) {
      ctx.logger?.warn?.(`View-once success notice failed: ${error.message}`);
    }
  },
};
