import { nowSeconds } from './helpers.js';

export const ECONOMY_CLAIM_FIELDS = Object.freeze(['last_daily', 'last_work', 'last_mine', 'last_rob']);

const CLAIM_FIELDS = new Set(ECONOMY_CLAIM_FIELDS);

/**
 * Shared data-access layer for the existing `economy` table.
 * Does not create a second ledger: it reads and writes the same rows
 * that NexusDatabase already persisted, so balances and claim timestamps
 * survive the migration unchanged. Bank funds live on the same row as
 * `bank_balance`, separate from spendable `balance`.
 */
export class EconomyStore {
  static ensureSchema(db) {
    if (!db || typeof db.prepare !== 'function') {
      throw new TypeError('An economy store needs a database handle.');
    }
    const columns = db.prepare('PRAGMA table_info(economy)').all();
    if (!columns.length) return;
    if (!columns.some((column) => column.name === 'bank_balance')) {
      db.exec('ALTER TABLE economy ADD COLUMN bank_balance INTEGER NOT NULL DEFAULT 0');
    }
  }

  constructor({ db, now = nowSeconds, transaction } = {}) {
    if (!db || typeof db.prepare !== 'function') {
      throw new TypeError('An economy store needs a database handle.');
    }
    EconomyStore.ensureSchema(db);
    this.db = db;
    this.now = typeof now === 'function' ? now : nowSeconds;
    this.transaction =
      typeof transaction === 'function' ? transaction : (fn) => this.db.transaction(fn)();
  }

  ensureEconomy(userJid) {
    this.db
      .prepare('INSERT OR IGNORE INTO economy (user_jid, balance, bank_balance, updated_at) VALUES (?, 0, 0, ?)')
      .run(userJid, this.now());
    return this.getEconomy(userJid);
  }

  getEconomy(userJid) {
    return this.db.prepare('SELECT * FROM economy WHERE user_jid = ?').get(userJid) || null;
  }

  claimEconomy(userJid, field, cooldownSeconds, amount, now = this.now()) {
    if (!CLAIM_FIELDS.has(field)) throw new Error(`Invalid economy claim field: ${field}`);
    return this.transaction(() => {
      this.ensureEconomy(userJid);
      const account = this.getEconomy(userJid);
      const last = account[field] || 0;
      if (now - last < cooldownSeconds) {
        return { claimed: false, nextAt: last + cooldownSeconds, balance: account.balance };
      }
      this.db
        .prepare(`UPDATE economy SET balance = balance + ?, ${field} = ?, updated_at = ? WHERE user_jid = ?`)
        .run(amount, now, now, userJid);
      return {
        claimed: true,
        nextAt: now + cooldownSeconds,
        balance: account.balance + amount,
      };
    });
  }

  creditBalance(userJid, amount) {
    const safeAmount = Math.max(0, Math.floor(Number(amount) || 0));
    return this.transaction(() => {
      this.ensureEconomy(userJid);
      this.db
        .prepare('UPDATE economy SET balance = balance + ?, updated_at = ? WHERE user_jid = ?')
        .run(safeAmount, this.now(), userJid);
      return this.getEconomy(userJid).balance;
    });
  }

  debitBalance(userJid, amount) {
    const safeAmount = Math.max(0, Math.floor(Number(amount) || 0));
    return this.transaction(() => {
      this.ensureEconomy(userJid);
      const result = this.db
        .prepare('UPDATE economy SET balance = balance - ?, updated_at = ? WHERE user_jid = ? AND balance >= ?')
        .run(safeAmount, this.now(), userJid, safeAmount);
      return result.changes === 1;
    });
  }

  transferBalance(fromJid, toJid, amount) {
    const safeAmount = Math.max(1, Math.floor(Number(amount) || 0));
    if (fromJid === toJid) return false;
    return this.transaction(() => {
      this.ensureEconomy(fromJid);
      const debit = this.db
        .prepare('UPDATE economy SET balance = balance - ?, updated_at = ? WHERE user_jid = ? AND balance >= ?')
        .run(safeAmount, this.now(), fromJid, safeAmount);
      if (debit.changes !== 1) return false;
      this.ensureEconomy(toJid);
      this.db
        .prepare('UPDATE economy SET balance = balance + ?, updated_at = ? WHERE user_jid = ?')
        .run(safeAmount, this.now(), toJid);
      return true;
    });
  }

  depositToBank(userJid, amount) {
    const safeAmount = Math.floor(Number(amount) || 0);
    if (!Number.isSafeInteger(safeAmount) || safeAmount < 1) return null;
    return this.transaction(() => {
      this.ensureEconomy(userJid);
      const result = this.db
        .prepare(
          `UPDATE economy
           SET balance = balance - ?, bank_balance = bank_balance + ?, updated_at = ?
           WHERE user_jid = ? AND balance >= ?`,
        )
        .run(safeAmount, safeAmount, this.now(), userJid, safeAmount);
      if (result.changes !== 1) return null;
      return this.getEconomy(userJid);
    });
  }

  withdrawFromBank(userJid, amount) {
    const safeAmount = Math.floor(Number(amount) || 0);
    if (!Number.isSafeInteger(safeAmount) || safeAmount < 1) return null;
    return this.transaction(() => {
      this.ensureEconomy(userJid);
      const result = this.db
        .prepare(
          `UPDATE economy
           SET bank_balance = bank_balance - ?, balance = balance + ?, updated_at = ?
           WHERE user_jid = ? AND bank_balance >= ?`,
        )
        .run(safeAmount, safeAmount, this.now(), userJid, safeAmount);
      if (result.changes !== 1) return null;
      return this.getEconomy(userJid);
    });
  }

  topBalances(limit = 10) {
    const safeLimit = Math.max(1, Math.min(50, Number(limit) || 10));
    return this.db
      .prepare('SELECT * FROM economy ORDER BY balance DESC, user_jid ASC LIMIT ?')
      .all(safeLimit);
  }

  economyStats() {
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS accounts,
                COALESCE(SUM(balance), 0) AS wallet,
                COALESCE(SUM(bank_balance), 0) AS banked,
                COALESCE(SUM(balance), 0) + COALESCE(SUM(bank_balance), 0) AS total
         FROM economy`,
      )
      .get();
    return { accounts: row.accounts, total: row.total, wallet: row.wallet, banked: row.banked };
  }
}

export function createEconomyStore(options = {}) {
  return new EconomyStore(options);
}
