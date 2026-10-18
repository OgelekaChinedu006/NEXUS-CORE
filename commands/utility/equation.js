import { directResponse } from '../../lib/formatter.js';
import { CommandError } from '../../lib/helpers.js';
import { evaluateEquation } from '../../lib/calculator.js';

export default {
  name: 'equation',
  aliases: ['calc'],
  description: 'Sever a mathematical equation down to its result.',
  category: 'utility',
  usage: 'equation <expression>',
  permissions: ['public'],
  cooldownMs: 1500,
  async execute(ctx) {
    if (!ctx.argsText) throw new CommandError('Provide an equation to sever.');
    const result = evaluateEquation(ctx.argsText);
    await ctx.reply(
      directResponse('EQUATION SEVERED', [
        `🩸 EXPRESSION: ${ctx.argsText.slice(0, 200)}`,
        `⚡ RESULT: ${result}`,
      ].join('\n')),
    );
  },
};
