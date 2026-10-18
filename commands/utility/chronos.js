import { fullFrame } from '../../lib/formatter.js';
import { CommandError, nowSeconds } from '../../lib/helpers.js';

function formatInZone(seconds, timezone) {
  try {
    return new Intl.DateTimeFormat('en-GB', {
      dateStyle: 'full',
      timeStyle: 'long',
      timeZone: timezone,
    }).format(new Date(seconds * 1000));
  } catch {
    throw new CommandError('That timezone is not recognized. Use an IANA name such as Europe/London.');
  }
}

export default {
  name: 'chronos',
  aliases: ['time'],
  description: 'Read the current moment through a chosen timezone.',
  category: 'utility',
  usage: 'chronos [timezone]',
  permissions: ['public'],
  cooldownMs: 1000,
  async execute(ctx) {
    const timezone = ctx.args[0] || ctx.config.timezone;
    const now = nowSeconds();
    const local = formatInZone(now, timezone);
    const configured = timezone === ctx.config.timezone ? null : formatInZone(now, ctx.config.timezone);

    await ctx.reply(
      fullFrame('⏳ CHRONOS', [
        `🌍 TIMEZONE: ${timezone}`,
        `🩸 MOMENT: ${local}`,
        configured ? `⚡ VESSEL TIME (${ctx.config.timezone}): ${configured}` : null,
        `⛓ UNIX: ${now}`,
        `👁 ISO: ${new Date(now * 1000).toISOString()}`,
      ]),
    );
  },
};
