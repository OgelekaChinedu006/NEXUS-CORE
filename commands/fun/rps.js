import { compactFrame } from '../../lib/formatter.js';
import { CommandError, displayMention, pick } from '../../lib/helpers.js';

const CHOICES = ['rock', 'paper', 'scissors'];
const EMOJI = { rock: '✊', paper: '✋', scissors: '✌️' };
const BEATS = { rock: 'scissors', paper: 'rock', scissors: 'paper' };
const SHORT = { r: 'rock', p: 'paper', s: 'scissors', '✊': 'rock', '✋': 'paper', '✌': 'scissors' };

function parseChoice(value) {
  const key = String(value || '').toLowerCase().replace(/\uFE0F/g, '').trim();
  if (CHOICES.includes(key)) return key;
  return Object.hasOwn(SHORT, key) ? SHORT[key] : null;
}

export default {
  name: 'rps',
  aliases: [],
  description: 'Play rock, paper, scissors against the bot.',
  category: 'fun',
  usage: 'rps <rock|paper|scissors>',
  permissions: ['public'],
  cooldownMs: 2000,
  async execute(ctx) {
    const player = parseChoice(ctx.args[0]);
    if (!player) {
      throw new CommandError(`Choose rock, paper or scissors. Usage: ${ctx.prefix}rps <rock|paper|scissors>`);
    }

    const bot = pick(CHOICES);
    let verdict;
    if (player === bot) verdict = '🤝 A draw. Neither side yields. How tedious.';
    else if (BEATS[player] === bot) verdict = `🏆 ${displayMention(ctx.senderJid)} wins. Acceptable.`;
    else verdict = '💀 The bot wins. As expected.';

    await ctx.reply(
      compactFrame('✊ ROCK PAPER SCISSORS', [
        `YOU: ${player} ${EMOJI[player]}`,
        `BOT: ${bot} ${EMOJI[bot]}`,
        verdict,
      ]),
      { mentions: [ctx.senderJid] },
    );
  },
};
