import { fullFrame } from '../../lib/formatter.js';
import {
  broadcastMentions,
  listEligibleParticipants,
  resolveMaxMentions,
} from '../../lib/mention-broadcast.js';

export default {
  name: 'summon',
  aliases: ['tagall'],
  description: 'Summon every soul in the domain at once.',
  category: 'domain',
  usage: 'summon [message]',
  permissions: ['admin'],
  cooldownMs: 10000,
  async execute(ctx) {
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
          'The summoning would break. No souls were named.',
        ]),
      );
      return;
    }

    const announcement = ctx.argsText
      ? `🩸 WORD: ${ctx.argsText.slice(0, 300)}`
      : '🩸 No words were given. Presence is demanded.';

    const result = await broadcastMentions(ctx, {
      participants,
      formatBatch(batch) {
        return {
          text: fullFrame(
            '📣 SUMMONING',
            [
              '👹 THE KING SUMMONS YOU.',
              announcement,
              '',
              ...chunkMentions(batch),
            ],
            { showFooter: true },
          ),
          mentions: batch,
        };
      },
    });

    if (result.failed > 0) {
      await ctx.reply(
        fullFrame('☠️ INCOMPLETE SUMMONING', [
          `🩸 NAMED: ${result.sent}`,
          `⛓ UNREACHED: ${result.failed}`,
          'The remaining souls were not mentioned.',
        ]),
      );
    }
  },
};

function chunkMentions(jids, perLine = 8) {
  const lines = [];
  for (let index = 0; index < jids.length; index += perLine) {
    lines.push(jids.slice(index, index + perLine).map((jid) => `@${jid.split('@')[0]}`).join(' '));
  }
  return lines;
}
