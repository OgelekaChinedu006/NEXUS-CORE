import { fullFrame } from '../../lib/formatter.js';

export default {
  name: 'purge',
  aliases: [],
  description: 'Erase every warning and moderation record in this domain.',
  category: 'domain',
  usage: 'purge',
  permissions: ['admin'],
  cooldownMs: 10000,
  async execute(ctx) {
    const warnings = ctx.db.clearWarnings(ctx.chatJid);
    const records = ctx.db.clearModeration(ctx.chatJid);
    ctx.db.logModeration(ctx.chatJid, 'purge', null, ctx.senderJid, 'Cleared warnings and moderation history');
    await ctx.reply(
      fullFrame('🧹 PURGE', [
        `⛓ WARNINGS ERASED: ${warnings}`,
        `🩸 MODERATION RECORDS ERASED: ${records}`,
        'The slate is clean. The next offense starts from zero.',
      ]),
    );
  },
};
