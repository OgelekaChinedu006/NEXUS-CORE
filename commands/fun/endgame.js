import { compactFrame } from '../../lib/formatter.js';
import { CommandError } from '../../lib/helpers.js';
import { sameUser } from '../../lib/identity.js';

export default {
  name: 'endgame',
  aliases: [],
  description: 'End the game running in this chat.',
  category: 'fun',
  usage: 'endgame',
  permissions: ['public'],
  cooldownMs: 2000,
  async execute(ctx) {
    const session = ctx.games?.get(ctx.chatJid) || null;
    if (!session) {
      await ctx.reply(compactFrame('🎲 NO ACTIVE GAME', ['No game is running in this chat. Do not waste my time.']));
      return;
    }

    const allowed =
      !ctx.isGroup ||
      ctx.isOwner ||
      ctx.isSudo ||
      ctx.isAdmin ||
      sameUser(ctx.groupMeta, session.starterJid, ctx.senderJid);
    if (!allowed) {
      throw new CommandError('Only the game starter, a group admin, or a NEXUS operator may end this game.');
    }

    ctx.games.end(ctx.chatJid);
    await ctx.reply(compactFrame('🛑 GAME ENDED', [`The ${session.type} game has been ended. Enough.`]));
  },
};
