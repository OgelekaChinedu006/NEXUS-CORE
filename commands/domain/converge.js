import { fullFrame } from '../../lib/formatter.js';
import { displayMention, normalizeJid } from '../../lib/helpers.js';

export default {
  name: 'converge',
  aliases: [],
  description: 'Name every soul in the domain, each mentioned in one gathering.',
  category: 'domain',
  usage: 'converge [message]',
  permissions: ['group'],
  cooldownMs: 10000,
  async execute(ctx) {
    if (!ctx.isGroup) {
      await ctx.reply(fullFrame('☠️ PRIVATE VOID', ['This gathering only works inside a group.']));
      return;
    }

    if (!ctx.groupMeta) {
      await ctx.reply(fullFrame('☠️ DOMAIN UNREADABLE', ['The domain metadata could not be read.']));
      return;
    }

    const participants = (ctx.groupMeta.participants || [])
      .map((participant) => normalizeJid(participant.id))
      .filter((jid) => jid && jid !== ctx.botJid);

    if (!participants.length) {
      await ctx.reply(fullFrame('☠️ EMPTY DOMAIN', ['No souls answered the register.']));
      return;
    }

    const maxMentions = Number(ctx.config?.security?.maxMentions) || 0;
    if (maxMentions > 0 && participants.length > maxMentions) {
      await ctx.reply(
        fullFrame('☠️ DOMAIN TOO VAST', [
          `🩸 SOULS: ${participants.length}`,
          `⛓ SAFE LIMIT: ${maxMentions}`,
          'The gathering would break. No souls were named.',
        ]),
      );
      return;
    }

    const lines = [
      '🌀 THE DOMAIN CONVERGES.',
      ctx.argsText ? `🩸 WORD: ${ctx.argsText.slice(0, 300)}` : '🩸 Every soul is named. None are spared.',
      '',
      ...participants.map((jid) => displayMention(jid)),
    ];

    await ctx.reply(fullFrame('🌀 CONVERGE', lines, { showFooter: true }), { mentions: participants });
  },
};
