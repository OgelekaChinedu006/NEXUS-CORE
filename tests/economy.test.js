import test from 'node:test';
import assert from 'node:assert/strict';
import { NexusDatabase } from '../lib/database.js';
import { ECONOMY_CLAIM_FIELDS, EconomyStore, createEconomyStore } from '../lib/economy.js';

const USER = '111@s.whatsapp.net';
const OTHER = '222@s.whatsapp.net';
const THIRD = '333@s.whatsapp.net';

function freshDb(t) {
  const db = new NexusDatabase(':memory:');
  t.after(() => db.close());
  return db;
}

function seedExistingRow(db, userJid, values) {
  const columns = db.db.prepare('PRAGMA table_info(economy)').all().map((column) => column.name);
  const hasBank = columns.includes('bank_balance');
  if (hasBank) {
    db.db
      .prepare(
        `INSERT INTO economy (user_jid, balance, bank_balance, last_daily, last_work, last_mine, last_rob, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        userJid,
        values.balance,
        values.bank_balance ?? 0,
        values.last_daily,
        values.last_work,
        values.last_mine,
        values.last_rob,
        values.updated_at,
      );
    return;
  }
  db.db
    .prepare(
      `INSERT INTO economy (user_jid, balance, last_daily, last_work, last_mine, last_rob, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      userJid,
      values.balance,
      values.last_daily,
      values.last_work,
      values.last_mine,
      values.last_rob,
      values.updated_at,
    );
}

test('EconomyStore is the shared access layer for the existing economy table', (t) => {
  const db = freshDb(t);
  assert.ok(db.economy instanceof EconomyStore);
  assert.deepEqual([...ECONOMY_CLAIM_FIELDS], ['last_daily', 'last_work', 'last_mine', 'last_rob']);

  db.creditBalance(USER, 80);
  assert.equal(db.economy.getEconomy(USER).balance, 80);
  assert.equal(db.getEconomy(USER).balance, 80);
});

test('existing economy rows keep their balances and claim timestamps', (t) => {
  const db = freshDb(t);
  seedExistingRow(db, USER, {
    balance: 450,
    last_daily: 1000,
    last_work: 2000,
    last_mine: 3000,
    last_rob: 4000,
    updated_at: 5000,
  });
  const store = createEconomyStore({ db: db.db, now: () => 9000 });

  const before = store.getEconomy(USER);
  assert.equal(before.balance, 450);
  assert.equal(before.last_daily, 1000);
  assert.equal(before.last_work, 2000);
  assert.equal(before.last_mine, 3000);
  assert.equal(before.last_rob, 4000);

  const ensured = store.ensureEconomy(USER);
  assert.equal(ensured.balance, 450);
  assert.equal(ensured.last_daily, 1000);
  assert.equal(ensured.updated_at, 5000);

  const count = db.db.prepare('SELECT COUNT(*) AS count FROM economy').get().count;
  assert.equal(count, 1);
});

test('ensureEconomy does not reset a populated account through NexusDatabase', (t) => {
  const db = freshDb(t);
  seedExistingRow(db, USER, {
    balance: 275,
    last_daily: 11,
    last_work: 22,
    last_mine: 33,
    last_rob: 44,
    updated_at: 55,
  });

  const account = db.ensureEconomy(USER);
  assert.equal(account.balance, 275);
  assert.equal(account.last_daily, 11);
  assert.equal(account.last_work, 22);
  assert.equal(account.last_mine, 33);
  assert.equal(account.last_rob, 44);
});

test('claims, credits, debits and transfers use one ledger', (t) => {
  const db = freshDb(t);
  const first = db.claimEconomy(USER, 'last_daily', 60, 100, 1000);
  assert.equal(first.claimed, true);
  assert.equal(first.balance, 100);

  const blocked = db.claimEconomy(USER, 'last_daily', 60, 50, 1010);
  assert.equal(blocked.claimed, false);
  assert.equal(blocked.balance, 100);
  assert.equal(blocked.nextAt, 1060);

  const later = db.claimEconomy(USER, 'last_daily', 60, 25, 1060);
  assert.equal(later.claimed, true);
  assert.equal(later.balance, 125);

  assert.equal(db.creditBalance(OTHER, 40), 40);
  assert.equal(db.debitBalance(USER, 25), true);
  assert.equal(db.getEconomy(USER).balance, 100);
  assert.equal(db.transferBalance(USER, OTHER, 30), true);
  assert.equal(db.getEconomy(USER).balance, 70);
  assert.equal(db.getEconomy(OTHER).balance, 70);

  const stats = db.economyStats();
  assert.equal(stats.accounts, 2);
  assert.equal(stats.total, 140);
});

test('invalid claim fields, self-transfers and overdrafts are rejected', (t) => {
  const db = freshDb(t);
  db.creditBalance(USER, 50);

  assert.throws(() => db.claimEconomy(USER, 'last_fish', 10, 5, 1), /Invalid economy claim field/);
  assert.throws(() => db.claimEconomy(USER, 'balance', 10, 5, 1), /Invalid economy claim field/);
  assert.equal(db.getEconomy(USER).balance, 50);

  assert.equal(db.transferBalance(USER, USER, 10), false);
  assert.equal(db.transferBalance(USER, OTHER, 1000), false);
  assert.equal(db.debitBalance(USER, 1000), false);
  assert.equal(db.getEconomy(USER).balance, 50);
  assert.equal(db.getEconomy(OTHER), null);
});

test('zero and negative credit or debit amounts never mutate a seeded balance', (t) => {
  const db = freshDb(t);
  seedExistingRow(db, USER, {
    balance: 90,
    last_daily: 0,
    last_work: 0,
    last_mine: 0,
    last_rob: 0,
    updated_at: 1,
  });

  assert.equal(db.creditBalance(USER, -25), 90);
  assert.equal(db.debitBalance(USER, -10), true);
  assert.equal(db.creditBalance(USER, 0.9), 90);
  assert.equal(db.getEconomy(USER).balance, 90);
});

test('topBalances ranks the shared table without duplicating accounts', (t) => {
  const db = freshDb(t);
  db.creditBalance(USER, 30);
  db.creditBalance(OTHER, 90);
  db.creditBalance(THIRD, 90);

  const top = db.topBalances(2);
  assert.equal(top.length, 2);
  assert.equal(top[0].user_jid, OTHER);
  assert.equal(top[1].user_jid, THIRD);
  assert.equal(db.economy.topBalances(2)[0].balance, 90);
});

test('createEconomyStore rejects a missing database handle', () => {
  assert.throws(() => createEconomyStore(), TypeError);
  assert.throws(() => new EconomyStore({}), TypeError);
});

test('deposits move wallet funds into bank_balance on the same row', (t) => {
  const db = freshDb(t);
  db.creditBalance(USER, 100);
  const deposited = db.depositToBank(USER, 40);
  assert.equal(deposited.balance, 60);
  assert.equal(deposited.bank_balance, 40);
  assert.equal(db.getEconomy(USER).balance, 60);
  assert.equal(db.getEconomy(USER).bank_balance, 40);
  assert.equal(db.economyStats().total, 100);
  assert.equal(db.economyStats().wallet, 60);
  assert.equal(db.economyStats().banked, 40);
});

test('withdrawals return bank funds to the wallet without creating wealth', (t) => {
  const db = freshDb(t);
  db.creditBalance(USER, 80);
  db.depositToBank(USER, 50);
  const withdrawn = db.withdrawFromBank(USER, 20);
  assert.equal(withdrawn.balance, 50);
  assert.equal(withdrawn.bank_balance, 30);
  assert.equal(db.economyStats().total, 80);
});

test('bank overdrafts and sub-one amounts do not move funds', (t) => {
  const db = freshDb(t);
  db.creditBalance(USER, 15);
  assert.equal(db.depositToBank(USER, 16), null);
  assert.equal(db.getEconomy(USER).balance, 15);
  assert.equal(db.getEconomy(USER).bank_balance, 0);

  db.depositToBank(USER, 10);
  assert.equal(db.withdrawFromBank(USER, 11), null);
  assert.equal(db.getEconomy(USER).balance, 5);
  assert.equal(db.getEconomy(USER).bank_balance, 10);

  const before = db.getEconomy(USER);
  assert.equal(db.depositToBank(USER, 0), null);
  assert.equal(db.withdrawFromBank(USER, 0), null);
  assert.equal(db.getEconomy(USER).balance, before.balance);
  assert.equal(db.getEconomy(USER).bank_balance, before.bank_balance);
});

test('legacy economy rows keep wallet funds and start with an empty bank', (t) => {
  const db = freshDb(t);
  seedExistingRow(db, USER, {
    balance: 275,
    last_daily: 11,
    last_work: 22,
    last_mine: 33,
    last_rob: 44,
    updated_at: 55,
  });
  const account = db.ensureEconomy(USER);
  assert.equal(account.balance, 275);
  assert.equal(account.bank_balance, 0);
  assert.equal(db.depositToBank(USER, 75).bank_balance, 75);
  assert.equal(db.getEconomy(USER).balance, 200);
});
