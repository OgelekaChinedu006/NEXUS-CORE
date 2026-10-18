import { fullFrame, progressBar } from '../../lib/formatter.js';
import { hashSeed, normalizeJid, pick, seededRandom } from '../../lib/helpers.js';

const TITLES = [
  'Fractured Vessel',
  'Silent Predator',
  'Bearer of Hollow Technique',
  'Ashen Wanderer',
  'Unbound Echo',
  'Cursed Prodigy',
  'Throne Adjacent',
];
const TECHNIQUES = [
  'Dismantle',
  'Cleave',
  'Malevolent Shrine',
  'Ten Shadows',
  'Blood Manipulation',
  'Cursed Speech',
  'Idle Transfiguration',
  'Ratio Technique',
];
const AFFINITIES = ['shadow', 'blood', 'void', 'flame', 'bone', 'echo', 'steel', 'dream'];

export default {
  name: 'soulscan',
  aliases: ['scan'],
  description: 'Read a soul\'s cursed signature and hidden affinity.',
  category: 'general',
  usage: 'soulscan [@user]',
  permissions: ['public'],
  cooldownMs: 5000,
  async execute(ctx) {
    const target = normalizeJid(ctx.targetJid || ctx.senderJid);
    if (!target) {
      await ctx.reply(fullFrame('☠️ UNREADABLE SOUL', ['No target could be identified.']));
      return;
    }

    const day = new Date().toISOString().slice(0, 10);
    const random = seededRandom(hashSeed(`${target}:${day}:soulscan`));
    const power = Math.floor(random() * 100) + 1;
    const title = pick(TITLES, random);
    const technique = pick(TECHNIQUES, random);
    const affinity = pick(AFFINITIES, random);
    const stability = Math.floor(random() * 100) + 1;

    await ctx.reply(
      fullFrame('🧿 SOUL SCAN', [
        `👁 SOUL: @${target.split('@')[0]}`,
        `🩸 TITLE: ${title}`,
        `⚔️ TECHNIQUE: ${technique}`,
        `🌑 AFFINITY: ${affinity}`,
        `🔥 CURSED ENERGY: ${progressBar(power, 100)}`,
        `⛓ STABILITY: ${progressBar(stability, 100)}`,
        '',
        `> ${power > 80 ? 'The reading is dangerous. Approach with respect.' : 'The signature is legible. Do not mistake it for mercy.'}`,
      ]),
      { mentions: [target] },
    );
  },
};
