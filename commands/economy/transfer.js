import { fullFrame } from '../../lib/formatter.js';
import { CommandError, normalizeJid, parseAmount, toUserJid } from '../../lib/helpers.js';

export default {
  name: 'transfer',
  aliases: ['pay'],
  description: 'Transfer cursed wealth from your treasury to another soul.',
  category: 'economy',
  usage: 'transfer <@user> <amount>',
  permissions: ['public'],
  cooldownMs: 5000,
  async execute(ctx) {
    const target = normalizeJid(ctx.targetJid || toUserJid(ctx.args[1]));
    if (!target) throw new CommandError('Mention the receiving soul, reply to them, or pass their JID.');
    if (target === ctx.senderJid) throw new CommandError('You cannot transfer wealth to yourself.');

    const amount = parseAmount(ctx.args.at(-1), { min: 10, max: 1_000_000 });
    if (!amount) throw new CommandError('Name an amount between 10 and 1,000,000.');

    const account = ctx.db.ensureEconomy(ctx.senderJid);
    if (account.balance < amount) {
      throw new CommandError(`Your treasury holds only ${account.balance}. The transfer was not made.`);
    }

    const moved = ctx.db.transferBalance(ctx.senderJid, target, amount);
    if (!moved) throw new CommandError('The transfer failed. The treasury rejected it.');
    ctx.db.logAudit(ctx.senderJid, 'economy-transfer', target, String(amount));

    const from = ctx.db.getEconomy(ctx.senderJid);
    await ctx.reply(
      fullFrame('💰 TRANSFER', [
        `🩸 RECIPIENT: @${target.split('@')[0]}`,
        `⚡ AMOUNT: ${amount}`,
        `👑 YOUR WEALTH: ${from.balance}`,
      ]),
      { mentions: [target] },
    );
  },
};
