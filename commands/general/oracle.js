import { fullFrame } from '../../lib/formatter.js';
import { hashSeed, pick, seededRandom } from '../../lib/helpers.js';

const OMENS = [
  'A door you ignored will open on its own.',
  'Someone will mistake your silence for permission.',
  'The next promise made to you will arrive with a price.',
  'A small mercy will return as a large advantage.',
  'What you bury today will be dug up by a stranger.',
  'The weakest voice in the room will name your mistake.',
  'A delayed answer is the answer. Do not summon it twice.',
];
const TACTICS = [
  'Strike once, then let the silence do the rest.',
  'Do not chase. Make them return to you.',
  'Guard your energy; the domain rewards patience.',
  'Speak last. The last word becomes law.',
  'Give nothing away until the terms are named.',
];

export default {
  name: 'oracle',
  aliases: [],
  description: 'Receive a dated prophecy for the current cycle.',
  category: 'general',
  usage: 'oracle [question]',
  permissions: ['public'],
  cooldownMs: 8000,
  async execute(ctx) {
    const day = new Date().toISOString().slice(0, 10);
    const random = seededRandom(hashSeed(`${ctx.senderJid}:${day}:oracle`));
    const omen = pick(OMENS, random);
    const tactic = pick(TACTICS, random);
    const severity = Math.floor(random() * 100) + 1;
    const question = ctx.argsText ? `❓ QUESTION: ${ctx.argsText.slice(0, 200)}` : '❓ QUESTION: unspoken';

    await ctx.reply(
      fullFrame('🔮 ORACLE', [
        `🌒 CYCLE: ${day}`,
        question,
        `🩸 OMEN: ${omen}`,
        `⚔️ TACTIC: ${tactic}`,
        `🔥 SEVERITY: ${severity}/100`,
        '',
        '> The prophecy dies at midnight. Act before it does.',
      ]),
      { mentions: [ctx.senderJid] },
    );
  },
};
