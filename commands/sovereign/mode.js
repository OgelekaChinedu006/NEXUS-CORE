import { fullFrame } from '../../lib/formatter.js';
import {
  ACCESS_MODE_DETAILS,
  ACCESS_MODES,
  getAccessMode,
  normalizeAccessMode,
  setAccessMode,
} from '../../lib/access-mode.js';

const MODE_ORDER = [ACCESS_MODES.VEIL, ACCESS_MODES.AWAKEN, ACCESS_MODES.COVENANT];

function modeLines(current) {
  return MODE_ORDER.map((mode) => {
    const marker = mode === current ? '▸' : ' ';
    return `${marker} ${mode.toUpperCase()} — ${ACCESS_MODE_DETAILS[mode]}`;
  });
}

export default {
  name: 'mode',
  aliases: [],
  description: 'Reveal or rewrite the vessel\'s global operating mode.',
  category: 'sovereign',
  usage: 'mode [veil|awaken|covenant]',
  permissions: ['owner'],
  cooldownMs: 2000,
  async execute(ctx) {
    const requested = String(ctx.args[0] || '').trim().toLowerCase();
    const current = getAccessMode(ctx.db);

    if (!requested) {
      await ctx.reply(
        fullFrame('☥ MODE', [
          `🩸 CURRENT: ${current.toUpperCase()}`,
          '',
          ...modeLines(current),
          '',
          `> ${ctx.prefix}mode veil|awaken|covenant`,
        ]),
      );
      return;
    }

    const next = normalizeAccessMode(requested);
    if (!next) {
      await ctx.reply(
        fullFrame('☥ MODE', [
          `"${requested}" is not a known mode.`,
          '',
          ...modeLines(current),
          '',
          `> ${ctx.prefix}mode veil|awaken|covenant`,
        ]),
      );
      return;
    }

    if (next === current) {
      await ctx.reply(
        fullFrame('☥ MODE', [
          `🩸 CURRENT: ${current.toUpperCase()}`,
          ACCESS_MODE_DETAILS[current],
          'The vessel already stands in this mode.',
        ]),
      );
      return;
    }

    setAccessMode(ctx.db, next);
    ctx.db.logAudit(ctx.senderJid, 'access-mode', null, next);
    await ctx.reply(
      fullFrame('☥ MODE', [
        `🩸 CURRENT: ${next.toUpperCase()}`,
        ACCESS_MODE_DETAILS[next],
      ]),
    );
  },
};
