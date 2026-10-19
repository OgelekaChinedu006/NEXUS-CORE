import { fullFrame } from '../../lib/formatter.js';
import { CommandError, parseAmount } from '../../lib/helpers.js';

function bankLines(account) {
  return [
    `👑 WALLET: ${account.balance}`,
    `🏦 BANK: ${account.bank_balance || 0}`,
  ];
}

export default {
  name: 'bank',
  aliases: ['deposit', 'withdraw'],
  description: 'Deposit wallet wealth into the bank, withdraw it, or read both balances.',
  category: 'economy',
  usage: 'bank [deposit|withdraw] [amount]',
  permissions: ['public'],
  cooldownMs: 3000,
  async execute(ctx) {
    if (!ctx.db) throw new CommandError('The treasury is not available.');

    const invoked = String(ctx.commandName || ctx.command?.name || 'bank').toLowerCase();
    const first = String(ctx.args[0] || '').toLowerCase();
    let action = 'status';
    let rawAmount = null;

    if (invoked === 'deposit') {
      action = 'deposit';
      rawAmount = ctx.args[0];
    } else if (invoked === 'withdraw') {
      action = 'withdraw';
      rawAmount = ctx.args[0];
    } else if (first === 'deposit' || first === 'withdraw') {
      action = first;
      rawAmount = ctx.args[1];
    } else if (first && first !== 'status' && first !== 'balance') {
      throw new CommandError(
        `Use ${ctx.prefix}bank, ${ctx.prefix}bank deposit <amount>, or ${ctx.prefix}bank withdraw <amount>.`,
      );
    }

    if (action === 'status') {
      const account = ctx.db.ensureEconomy(ctx.senderJid);
      await ctx.reply(fullFrame('🏦 BANK', bankLines(account)));
      return;
    }

    const amount = parseAmount(rawAmount, { min: 1, max: 1_000_000 });
    if (!amount) throw new CommandError('Name an amount between 1 and 1,000,000.');

    const account = ctx.db.ensureEconomy(ctx.senderJid);
    if (action === 'deposit') {
      if (account.balance < amount) {
        throw new CommandError(`Your wallet holds only ${account.balance}. The deposit was not made.`);
      }
      const updated = ctx.db.depositToBank(ctx.senderJid, amount);
      if (!updated) throw new CommandError('The deposit failed. The treasury rejected it.');
      await ctx.reply(fullFrame('🏦 DEPOSIT', [`⚡ AMOUNT: ${amount}`, ...bankLines(updated)]));
      return;
    }

    if ((account.bank_balance || 0) < amount) {
      throw new CommandError(`Your bank holds only ${account.bank_balance || 0}. The withdrawal was not made.`);
    }
    const updated = ctx.db.withdrawFromBank(ctx.senderJid, amount);
    if (!updated) throw new CommandError('The withdrawal failed. The treasury rejected it.');
    await ctx.reply(fullFrame('🏦 WITHDRAWAL', [`⚡ AMOUNT: ${amount}`, ...bankLines(updated)]));
  },
};
