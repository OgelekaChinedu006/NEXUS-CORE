import { fullFrame } from '../../lib/formatter.js';
import { normalizeJid } from '../../lib/helpers.js';

export default {
  name: 'shadowtag',
  aliases: ['tagadmins'],
  description: 'Call only the domain\'s administrators out of the shadows.',
  category: 'domain',
  usage: 'shadowtag [message]',
  permissions: ['admin'],
  cooldownMs: 8000,
  async execute(ctx) {
    const admins = (ctx.groupMeta?.participants || [])
      .filter((participant) => participant.admin)
      .map((participant) => normalizeJid(participant.id))
      .filter((jid) => jid && jid !== ctx.botJid);

    if (!admins.length) {
      await ctx.reply(fullFrame('☠️ NO ADMINISTRATORS', ['The shadows are empty.']));
      return;
    }

    const limited = admins.slice(0, ctx.config.security.maxMentions);
    const lines = [
      '👁 THE THRONE REQUIRES ITS ADMINISTRATORS.',
      ctx.argsText ? `🩸 WORD: ${ctx.argsText.slice(0, 300)}` : '🩸 Step forward. The domain is watching.',
      '',
      limited.map((jid) => `@${jid.split('@')[0]}`).join(' '),
    ];

    await ctx.reply(fullFrame('🌑 SHADOWTAG', lines), { mentions: limited });
  },
};
