import { fullFrame } from '../../lib/formatter.js';
import { normalizeJid } from '../../lib/helpers.js';

export default {
  name: 'summon',
  aliases: ['tagall'],
  description: 'Summon every soul in the domain at once.',
  category: 'domain',
  usage: 'summon [message]',
  permissions: ['admin'],
  cooldownMs: 10000,
  async execute(ctx) {
    const participants = (ctx.groupMeta?.participants || [])
      .map((participant) => normalizeJid(participant.id))
      .filter((jid) => jid && jid !== ctx.botJid);

    if (!participants.length) {
      await ctx.reply(fullFrame('☠️ EMPTY DOMAIN', ['No souls answered the register.']));
      return;
    }

    const limited = participants.slice(0, ctx.config.security.maxMentions);
    const lines = [
      '👹 THE KING SUMMONS YOU.',
      ctx.argsText ? `🩸 WORD: ${ctx.argsText.slice(0, 300)}` : '🩸 No words were given. Presence is demanded.',
      '',
      ...chunkMentions(limited),
    ];
    if (participants.length > limited.length) {
      lines.push('', `⚠️ ${participants.length - limited.length} soul(s) exceeded the summoning limit.`);
    }

    await ctx.reply(fullFrame('📣 SUMMONING', lines, { showFooter: true }), { mentions: limited });
  },
};

function chunkMentions(jids, perLine = 8) {
  const lines = [];
  for (let index = 0; index < jids.length; index += perLine) {
    lines.push(jids.slice(index, index + perLine).map((jid) => `@${jid.split('@')[0]}`).join(' '));
  }
  return lines;
}
