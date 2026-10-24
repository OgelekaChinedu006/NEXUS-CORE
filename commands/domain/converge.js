import { fullFrame } from '../../lib/formatter.js';
import { displayMention } from '../../lib/helpers.js';
import {
  broadcastMentions,
  listEligibleParticipants,
  resolveMaxMentions,
} from '../../lib/mention-broadcast.js';

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

    const participants = listEligibleParticipants(ctx.groupMeta, ctx.botJid);

    if (!participants.length) {
      await ctx.reply(fullFrame('☠️ EMPTY DOMAIN', ['No souls answered the register.']));
      return;
    }

    const maxMentions = resolveMaxMentions(ctx.config);
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

    const announcement = ctx.argsText
      ? `🩸 WORD: ${ctx.argsText.slice(0, 300)}`
      : '🩸 Every soul is named. None are spared.';

    const result = await broadcastMentions(ctx, {
      participants,
      formatBatch(batch) {
        return {
          text: fullFrame(
            '🌀 CONVERGE',
            [
              '🌀 THE DOMAIN CONVERGES.',
              announcement,
              '',
              ...batch.map((jid) => displayMention(jid)),
            ],
            { showFooter: true },
          ),
          mentions: batch,
        };
      },
    });

    if (result.failed > 0) {
      await ctx.reply(
        fullFrame('☠️ INCOMPLETE CONVERGE', [
          `🩸 NAMED: ${result.sent}`,
          `⛓ UNREACHED: ${result.failed}`,
          'The remaining souls were not mentioned.',
        ]),
      );
    }
  },
};
