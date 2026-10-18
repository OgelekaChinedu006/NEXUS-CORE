import { fullFrame } from '../../lib/formatter.js';
import { describePermissions } from '../../lib/permissions.js';
import { CATEGORY_LABELS } from '../../lib/registry.js';

export default {
  name: 'beg',
  aliases: ['help'],
  description: 'Beg the shrine for one curse\'s exact usage and authority.',
  category: 'general',
  usage: 'beg <command>',
  permissions: ['public'],
  cooldownMs: 1500,
  async execute(ctx) {
    const query = (ctx.args[0] || '').toLowerCase();
    if (!query) {
      await ctx.reply(
        fullFrame('☠️ BEG FOR KNOWLEDGE', [
          `Speak a curse name: ${ctx.prefix}beg <command>`,
          `Witness every curse: ${ctx.prefix}shrine`,
        ]),
      );
      return;
    }

    const command = ctx.registry.get(query);
    if (!command) {
      await ctx.reply(
        fullFrame('☠️ NO SUCH CURSE', [
          `"${query}" is not bound to this vessel.`,
          `Use ${ctx.prefix}shrine to see what actually exists.`,
        ]),
      );
      return;
    }

    const aliases = command.aliases.length ? command.aliases.map((alias) => `${ctx.prefix}${alias}`).join(', ') : 'none';
    await ctx.reply(
      fullFrame(`📜 ${command.name.toUpperCase()}`, [
        `🩸 DOMAIN: ${CATEGORY_LABELS[command.category] || command.category.toUpperCase()}`,
        `⚡ USAGE: ${ctx.prefix}${command.usage}`,
        `👁 DESCRIPTION: ${command.description}`,
        `⛓ ALIASES: ${aliases}`,
        `👑 AUTHORITY: ${describePermissions(command.permissions)}`,
        command.cooldownMs ? `⏳ COOLDOWN: ${Math.ceil(command.cooldownMs / 1000)}s` : '⏳ COOLDOWN: none',
      ]),
    );
  },
};
