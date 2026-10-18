import { directResponse } from '../../lib/formatter.js';
import { hashSeed, normalizeJid, sanitizeField, seededRandom } from '../../lib/helpers.js';

const RUNES = 'ᚠᚢᚦᚨᚱᚲᚷᚹᚺᚾᛁᛃᛇᛈᛉᛊᛏᛒᛖᛗᛚᛜᛞᛟ';
const GLYPHS = '☠☥⚔⛓🕯🩸👁🔥⛩🌑';

function makeSigil(seed) {
  const random = seededRandom(seed);
  const lines = [];
  for (let line = 0; line < 3; line += 1) {
    let fragment = '';
    for (let index = 0; index < 9; index += 1) {
      fragment += RUNES[Math.floor(random() * RUNES.length)];
      if (index === 4) fragment += ' ';
    }
    lines.push(`   ${fragment}`);
  }
  const glyph = GLYPHS[Math.floor(random() * GLYPHS.length)];
  return { lines, glyph };
}

export default {
  name: 'sigil',
  aliases: ['sealmark'],
  description: 'Forge a deterministic cursed sigil from a name.',
  category: 'general',
  usage: 'sigil [name]',
  permissions: ['public'],
  cooldownMs: 3000,
  async execute(ctx) {
    const supplied = sanitizeField(ctx.argsText, 80);
    const name = supplied || (ctx.targetJid ? normalizeJid(ctx.targetJid).split('@')[0] : ctx.senderJid.split('@')[0]);
    const seed = hashSeed(`${ctx.senderJid}:${name}`);
    const sigil = makeSigil(seed);
    await ctx.reply(
      directResponse(`SIGIL OF ${name.toUpperCase()}`, [
        '```',
        ...sigil.lines,
        '```',
        '',
        `${sigil.glyph} The mark is fixed. It will not change until the name does.`,
      ].join('\n')),
    );
  },
};
