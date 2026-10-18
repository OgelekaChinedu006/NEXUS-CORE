import { compactFrame } from '../../lib/formatter.js';
import { cleanReason, moderationTarget } from '../../lib/command-utils.js';
import { warnUser } from '../../lib/moderation.js';

export default {
  name: 'condemn',
  aliases: ['warn'],
  description: 'Mark a soul with a warning; enough marks mean banishment.',
  category: 'domain',
  usage: 'condemn <@user> [reason]',
  permissions: ['admin', 'botAdmin'],
  async execute(ctx) {
    const target = moderationTarget(ctx);
    const reason = cleanReason(ctx.argsText);
    const result = await warnUser({
      db: ctx.db,
      sock: ctx.sock,
      logger: ctx.logger,
      group: ctx.group,
      groupMeta: ctx.groupMeta,
      groupJid: ctx.chatJid,
      targetJid: target,
      actorJid: ctx.senderJid,
      reason,
      botJid: ctx.botJid,
      notify: true,
      autoKick: true,
    });
    if (!result.count) {
      await ctx.reply(compactFrame('☠️ JUDGMENT FAILED', ['The warning could not be recorded.']));
    }
  },
};
