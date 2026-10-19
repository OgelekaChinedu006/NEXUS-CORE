import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { loadCommands } from '../lib/registry.js';
import { createLogger } from '../lib/logger.js';
import { CommandError } from '../lib/helpers.js';
import { EconomyStore } from '../lib/economy.js';
import bankCommand from '../commands/economy/bank.js';

const ROOT = path.resolve(import.meta.dirname, '..');
const SENDER = '111@s.whatsapp.net';
const silent = createLogger({ level: 'silent' });

function makeDb(account) {
  return {
    ensureEconomy() {
      return account;
    },
    depositToBank(_jid, amount) {
      if (account.balance < amount) return null;
      account.balance -= amount;
      account.bank_balance += amount;
      return { ...account };
    },
    withdrawFromBank(_jid, amount) {
      if (account.bank_balance < amount) return null;
      account.bank_balance -= amount;
      account.balance += amount;
      return { ...account };
    },
  };
}

function makeCtx({ args = [], commandName = 'bank', account = { balance: 200, bank_balance: 50 } } = {}) {
  const replies = [];
  const db = makeDb(account);
  return {
    replies,
    account,
    db,
    ctx: {
      prefix: '!',
      args,
      argsText: args.join(' '),
      senderJid: SENDER,
      commandName,
      command: { name: commandName },
      db,
      reply: async (text) => {
        replies.push(text);
      },
    },
  };
}

test('ensureSchema adds bank_balance to a legacy economy table and is idempotent', () => {
  const execs = [];
  const legacy = {
    prepare(sql) {
      assert.match(sql, /PRAGMA table_info\(economy\)/);
      return { all: () => [{ name: 'user_jid' }, { name: 'balance' }, { name: 'updated_at' }] };
    },
    exec(sql) {
      execs.push(sql);
    },
  };
  EconomyStore.ensureSchema(legacy);
  assert.equal(execs.length, 1);
  assert.match(execs[0], /ADD COLUMN bank_balance INTEGER NOT NULL DEFAULT 0/);

  const current = {
    prepare() {
      return { all: () => [{ name: 'balance' }, { name: 'bank_balance' }] };
    },
    exec() {
      throw new Error('should not alter an already-migrated table');
    },
  };
  EconomyStore.ensureSchema(current);
});

test('ensureSchema skips an absent economy table', () => {
  EconomyStore.ensureSchema({
    prepare() {
      return { all: () => [] };
    },
    exec() {
      throw new Error('should not alter when the table is missing');
    },
  });
});

test('bank is a public economy command with deposit and withdraw aliases', async () => {
  assert.equal(bankCommand.name, 'bank');
  assert.deepEqual(bankCommand.aliases, ['deposit', 'withdraw']);
  assert.equal(bankCommand.category, 'economy');
  assert.deepEqual(bankCommand.permissions, ['public']);

  const registry = await loadCommands(path.join(ROOT, 'commands'), silent);
  assert.equal(registry.get('bank'), registry.get('deposit'));
  assert.equal(registry.get('bank'), registry.get('withdraw'));
  assert.match(registry.get('bank').source, /commands[\\/]economy[\\/]bank\.js$/);
});

test('bank with no argument reports wallet and bank balances', async () => {
  const { ctx, replies } = makeCtx();
  await bankCommand.execute(ctx);
  assert.match(replies[0], /WALLET: 200/);
  assert.match(replies[0], /BANK: 50/);
});

test('bank deposit moves wallet funds into the bank', async () => {
  const { ctx, replies, account } = makeCtx({ args: ['deposit', '80'] });
  await bankCommand.execute(ctx);
  assert.equal(account.balance, 120);
  assert.equal(account.bank_balance, 130);
  assert.match(replies[0], /DEPOSIT/);
  assert.match(replies[0], /AMOUNT: 80/);
  assert.match(replies[0], /WALLET: 120/);
  assert.match(replies[0], /BANK: 130/);
});

test('bank withdraw returns bank funds to the wallet', async () => {
  const { ctx, replies, account } = makeCtx({ args: ['withdraw', '40'] });
  await bankCommand.execute(ctx);
  assert.equal(account.balance, 240);
  assert.equal(account.bank_balance, 10);
  assert.match(replies[0], /WITHDRAWAL/);
  assert.match(replies[0], /AMOUNT: 40/);
});

test('deposit and withdraw aliases parse the amount from the first argument', async () => {
  const deposit = makeCtx({ args: ['25'], commandName: 'deposit', account: { balance: 25, bank_balance: 0 } });
  await bankCommand.execute(deposit.ctx);
  assert.equal(deposit.account.balance, 0);
  assert.equal(deposit.account.bank_balance, 25);

  const withdraw = makeCtx({ args: ['10'], commandName: 'withdraw', account: { balance: 0, bank_balance: 10 } });
  await bankCommand.execute(withdraw.ctx);
  assert.equal(withdraw.account.balance, 10);
  assert.equal(withdraw.account.bank_balance, 0);
});

test('invalid amounts and unknown actions are rejected without moving funds', async () => {
  const unknown = makeCtx({ args: ['vault'] });
  await assert.rejects(() => bankCommand.execute(unknown.ctx), CommandError);
  assert.equal(unknown.account.balance, 200);

  for (const args of [['deposit'], ['deposit', '0'], ['deposit', '-5'], ['withdraw', '1.5'], ['deposit', 'abc']]) {
    const { ctx, account } = makeCtx({ args });
    await assert.rejects(() => bankCommand.execute(ctx), CommandError);
    assert.equal(account.balance, 200);
    assert.equal(account.bank_balance, 50);
  }
});

test('overdrafts are rejected and leave both balances unchanged', async () => {
  const deposit = makeCtx({ args: ['deposit', '201'] });
  await assert.rejects(() => bankCommand.execute(deposit.ctx), /wallet holds only 200/);
  assert.equal(deposit.account.balance, 200);
  assert.equal(deposit.account.bank_balance, 50);

  const withdraw = makeCtx({ args: ['withdraw', '51'] });
  await assert.rejects(() => bankCommand.execute(withdraw.ctx), /bank holds only 50/);
  assert.equal(withdraw.account.balance, 200);
  assert.equal(withdraw.account.bank_balance, 50);
});

test('the command fails cleanly without a database', async () => {
  const { ctx } = makeCtx();
  ctx.db = null;
  await assert.rejects(() => bankCommand.execute(ctx), CommandError);
});
