import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { nowSeconds } from './helpers.js';
import { EconomyStore } from './economy.js';
import { QuizHistoryStore } from './games/quiz-history.js';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS groups (
  jid TEXT PRIMARY KEY,
  name TEXT,
  prefix TEXT,
  welcome_enabled INTEGER NOT NULL DEFAULT 0,
  welcome_text TEXT,
  goodbye_enabled INTEGER NOT NULL DEFAULT 0,
  goodbye_text TEXT,
  rules TEXT,
  antilink INTEGER NOT NULL DEFAULT 0,
  profanity INTEGER NOT NULL DEFAULT 0,
  antispam INTEGER NOT NULL DEFAULT 0,
  sealed INTEGER NOT NULL DEFAULT 0,
  max_warnings INTEGER NOT NULL DEFAULT 3,
  member_add_mode TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS warnings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_jid TEXT NOT NULL,
  user_jid TEXT NOT NULL,
  reason TEXT NOT NULL,
  issued_by TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_warnings_group_user ON warnings(group_jid, user_jid);
CREATE INDEX IF NOT EXISTS idx_warnings_group_created ON warnings(group_jid, created_at);

CREATE TABLE IF NOT EXISTS moderation (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_jid TEXT NOT NULL,
  action TEXT NOT NULL,
  target_jid TEXT,
  actor_jid TEXT,
  reason TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_moderation_group_created ON moderation(group_jid, created_at);

CREATE TABLE IF NOT EXISTS operators (
  user_jid TEXT PRIMARY KEY,
  added_by TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS global_bans (
  user_jid TEXT PRIMARY KEY,
  reason TEXT,
  banned_by TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS group_bans (
  group_jid TEXT NOT NULL,
  user_jid TEXT NOT NULL,
  reason TEXT,
  banned_by TEXT,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (group_jid, user_jid)
);

CREATE TABLE IF NOT EXISTS group_allies (
  group_jid TEXT NOT NULL,
  user_jid TEXT NOT NULL,
  added_by TEXT,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (group_jid, user_jid)
);

CREATE TABLE IF NOT EXISTS users (
  user_jid TEXT PRIMARY KEY,
  messages INTEGER NOT NULL DEFAULT 0,
  commands INTEGER NOT NULL DEFAULT 0,
  first_seen INTEGER NOT NULL,
  last_seen INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS group_activity (
  group_jid TEXT NOT NULL,
  user_jid TEXT NOT NULL,
  messages INTEGER NOT NULL DEFAULT 0,
  commands INTEGER NOT NULL DEFAULT 0,
  last_seen INTEGER NOT NULL,
  PRIMARY KEY (group_jid, user_jid)
);

CREATE TABLE IF NOT EXISTS economy (
  user_jid TEXT PRIMARY KEY,
  balance INTEGER NOT NULL DEFAULT 0,
  bank_balance INTEGER NOT NULL DEFAULT 0,
  last_daily INTEGER NOT NULL DEFAULT 0,
  last_work INTEGER NOT NULL DEFAULT 0,
  last_mine INTEGER NOT NULL DEFAULT 0,
  last_rob INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS processed_messages (
  message_id TEXT PRIMARY KEY,
  chat_jid TEXT NOT NULL,
  processed_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_processed_at ON processed_messages(processed_at);

CREATE TABLE IF NOT EXISTS confessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_jid TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS audits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_jid TEXT,
  action TEXT NOT NULL,
  target TEXT,
  details TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS quiz_cycles (
  user_jid TEXT NOT NULL,
  kind TEXT NOT NULL,
  remaining TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_jid, kind)
);
`;

const GROUP_FIELDS = new Set([
  'name',
  'prefix',
  'welcome_enabled',
  'welcome_text',
  'goodbye_enabled',
  'goodbye_text',
  'rules',
  'antilink',
  'profanity',
  'antispam',
  'sealed',
  'max_warnings',
  'member_add_mode',
]);

export class NexusDatabase {
  constructor(filePath = ':memory:') {
    this.filePath = filePath;
    if (filePath !== ':memory:') {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
    }
    this.db = new Database(filePath);
    if (filePath !== ':memory:') {
      this.db.pragma('journal_mode = WAL');
    }
    this.db.pragma('foreign_keys = ON');
    this.db.pragma('busy_timeout = 5000');
    this.db.exec(SCHEMA);
    EconomyStore.ensureSchema(this.db);
    QuizHistoryStore.ensureSchema(this.db);
    this.economy = new EconomyStore({
      db: this.db,
      now: nowSeconds,
      transaction: (fn) => this.transaction(fn),
    });
    this.quizHistory = new QuizHistoryStore({
      db: this.db,
      now: nowSeconds,
      transaction: (fn) => this.transaction(fn),
    });
  }

  close() {
    if (this.db.open) this.db.close();
  }

  ping() {
    return this.db.prepare('SELECT 1 AS ok').get().ok === 1;
  }

  transaction(fn) {
    return this.db.transaction(fn)();
  }

  getSetting(key, fallback = null) {
    const row = this.db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
    return row ? row.value : fallback;
  }

  getSettingBool(key, fallback = false) {
    const value = this.getSetting(key, null);
    if (value === null) return fallback;
    return value === '1' || value === 'true';
  }

  setSetting(key, value) {
    this.db
      .prepare(
        `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      )
      .run(String(key), String(value), nowSeconds());
  }

  deleteSetting(key) {
    return this.db.prepare('DELETE FROM settings WHERE key = ?').run(String(key)).changes;
  }

  ensureGroup(jid, name = null) {
    const now = nowSeconds();
    this.db
      .prepare(
        `INSERT INTO groups (jid, name, created_at, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(jid) DO NOTHING`,
      )
      .run(jid, name || null, now, now);
    if (name) {
      this.db
        .prepare(
          `UPDATE groups SET name = ?, updated_at = ?
           WHERE jid = ? AND (name IS NULL OR name <> ?)`,
        )
        .run(String(name).slice(0, 200), now, jid, String(name).slice(0, 200));
    }
    return this.getGroup(jid);
  }

  getGroup(jid) {
    return this.db.prepare('SELECT * FROM groups WHERE jid = ?').get(jid) || null;
  }

  updateGroup(jid, patch) {
    this.ensureGroup(jid);
    const entries = Object.entries(patch).filter(([key]) => GROUP_FIELDS.has(key));
    if (entries.length === 0) return this.getGroup(jid);
    const assignments = entries.map(([key]) => `${key} = ?`);
    const values = entries.map(([, value]) => value);
    assignments.push('updated_at = ?');
    values.push(nowSeconds(), jid);
    this.db.prepare(`UPDATE groups SET ${assignments.join(', ')} WHERE jid = ?`).run(...values);
    return this.getGroup(jid);
  }

  listGroups() {
    return this.db.prepare('SELECT * FROM groups ORDER BY name COLLATE NOCASE ASC, jid ASC').all();
  }

  addWarning(groupJid, userJid, reason, issuedBy) {
    this.db
      .prepare(
        'INSERT INTO warnings (group_jid, user_jid, reason, issued_by, created_at) VALUES (?, ?, ?, ?, ?)',
      )
      .run(groupJid, userJid, String(reason).slice(0, 500), issuedBy, nowSeconds());
    return this.countWarnings(groupJid, userJid);
  }

  countWarnings(groupJid, userJid) {
    return this.db
      .prepare('SELECT COUNT(*) AS count FROM warnings WHERE group_jid = ? AND user_jid = ?')
      .get(groupJid, userJid).count;
  }

  listWarnings(groupJid, userJid = null, limit = 20) {
    const safeLimit = Math.max(1, Math.min(100, Number(limit) || 20));
    if (userJid) {
      return this.db
        .prepare(
          'SELECT * FROM warnings WHERE group_jid = ? AND user_jid = ? ORDER BY created_at DESC, id DESC LIMIT ?',
        )
        .all(groupJid, userJid, safeLimit);
    }
    return this.db
      .prepare(
        'SELECT * FROM warnings WHERE group_jid = ? ORDER BY created_at DESC, id DESC LIMIT ?',
      )
      .all(groupJid, safeLimit);
  }

  clearWarnings(groupJid, userJid = null) {
    if (userJid) {
      return this.db
        .prepare('DELETE FROM warnings WHERE group_jid = ? AND user_jid = ?')
        .run(groupJid, userJid).changes;
    }
    return this.db.prepare('DELETE FROM warnings WHERE group_jid = ?').run(groupJid).changes;
  }

  logModeration(groupJid, action, targetJid, actorJid, reason = '') {
    this.db
      .prepare(
        'INSERT INTO moderation (group_jid, action, target_jid, actor_jid, reason, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(groupJid, action, targetJid || null, actorJid || null, String(reason || '').slice(0, 500), nowSeconds());
  }

  listModeration(groupJid, limit = 20) {
    const safeLimit = Math.max(1, Math.min(100, Number(limit) || 20));
    return this.db
      .prepare(
        'SELECT * FROM moderation WHERE group_jid = ? ORDER BY created_at DESC, id DESC LIMIT ?',
      )
      .all(groupJid, safeLimit);
  }

  clearModeration(groupJid) {
    return this.db.prepare('DELETE FROM moderation WHERE group_jid = ?').run(groupJid).changes;
  }

  addOperator(userJid, addedBy) {
    this.db
      .prepare('INSERT OR IGNORE INTO operators (user_jid, added_by, created_at) VALUES (?, ?, ?)')
      .run(userJid, addedBy || null, nowSeconds());
    return this.isOperator(userJid);
  }

  removeOperator(userJid) {
    return this.db.prepare('DELETE FROM operators WHERE user_jid = ?').run(userJid).changes;
  }

  isOperator(userJid) {
    return Boolean(this.db.prepare('SELECT 1 AS ok FROM operators WHERE user_jid = ?').get(userJid));
  }

  listOperators() {
    return this.db.prepare('SELECT * FROM operators ORDER BY created_at ASC').all();
  }

  banGlobal(userJid, reason, bannedBy) {
    this.db
      .prepare(
        `INSERT INTO global_bans (user_jid, reason, banned_by, created_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(user_jid) DO UPDATE SET reason = excluded.reason, banned_by = excluded.banned_by`,
      )
      .run(userJid, String(reason || '').slice(0, 500), bannedBy, nowSeconds());
  }

  unbanGlobal(userJid) {
    return this.db.prepare('DELETE FROM global_bans WHERE user_jid = ?').run(userJid).changes;
  }

  isGloballyBanned(userJid) {
    return Boolean(this.db.prepare('SELECT 1 AS ok FROM global_bans WHERE user_jid = ?').get(userJid));
  }

  listGlobalBans() {
    return this.db.prepare('SELECT * FROM global_bans ORDER BY created_at DESC').all();
  }

  banFromGroup(groupJid, userJid, reason, bannedBy) {
    this.db
      .prepare(
        `INSERT INTO group_bans (group_jid, user_jid, reason, banned_by, created_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(group_jid, user_jid) DO UPDATE SET reason = excluded.reason, banned_by = excluded.banned_by`,
      )
      .run(groupJid, userJid, String(reason || '').slice(0, 500), bannedBy, nowSeconds());
  }

  unbanFromGroup(groupJid, userJid) {
    return this.db
      .prepare('DELETE FROM group_bans WHERE group_jid = ? AND user_jid = ?')
      .run(groupJid, userJid).changes;
  }

  isBannedFromGroup(groupJid, userJid) {
    return Boolean(
      this.db
        .prepare('SELECT 1 AS ok FROM group_bans WHERE group_jid = ? AND user_jid = ?')
        .get(groupJid, userJid),
    );
  }

  listGroupBans(groupJid) {
    return this.db.prepare('SELECT * FROM group_bans WHERE group_jid = ?').all(groupJid);
  }

  addAlly(groupJid, userJid, addedBy) {
    this.db
      .prepare('INSERT OR IGNORE INTO group_allies (group_jid, user_jid, added_by, created_at) VALUES (?, ?, ?, ?)')
      .run(groupJid, userJid, addedBy || null, nowSeconds());
  }

  removeAlly(groupJid, userJid) {
    return this.db
      .prepare('DELETE FROM group_allies WHERE group_jid = ? AND user_jid = ?')
      .run(groupJid, userJid).changes;
  }

  isAlly(groupJid, userJid) {
    return Boolean(
      this.db
        .prepare('SELECT 1 AS ok FROM group_allies WHERE group_jid = ? AND user_jid = ?')
        .get(groupJid, userJid),
    );
  }

  listAllies(groupJid) {
    return this.db.prepare('SELECT * FROM group_allies WHERE group_jid = ?').all(groupJid);
  }

  recordActivity(userJid, { groupJid = null, isCommand = false } = {}) {
    const now = nowSeconds();
    this.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO users (user_jid, messages, commands, first_seen, last_seen)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(user_jid) DO UPDATE SET
             messages = messages + excluded.messages,
             commands = commands + excluded.commands,
             last_seen = excluded.last_seen`,
        )
        .run(userJid, isCommand ? 0 : 1, isCommand ? 1 : 0, now, now);
      if (groupJid) {
        this.db
          .prepare(
            `INSERT INTO group_activity (group_jid, user_jid, messages, commands, last_seen)
             VALUES (?, ?, ?, ?, ?)
             ON CONFLICT(group_jid, user_jid) DO UPDATE SET
               messages = messages + excluded.messages,
               commands = commands + excluded.commands,
               last_seen = excluded.last_seen`,
          )
          .run(groupJid, userJid, isCommand ? 0 : 1, isCommand ? 1 : 0, now);
      }
    });
  }

  getUser(userJid) {
    return this.db.prepare('SELECT * FROM users WHERE user_jid = ?').get(userJid) || null;
  }

  getUserStats(userJid) {
    const user = this.getUser(userJid);
    const warnings = this.db
      .prepare('SELECT COUNT(*) AS count FROM warnings WHERE user_jid = ?')
      .get(userJid).count;
    return {
      messages: user?.messages || 0,
      commands: user?.commands || 0,
      warnings,
      firstSeen: user?.first_seen || null,
      lastSeen: user?.last_seen || null,
    };
  }

  getGroupActivity(groupJid, limit = 10) {
    const safeLimit = Math.max(1, Math.min(50, Number(limit) || 10));
    return this.db
      .prepare(
        `SELECT * FROM group_activity
         WHERE group_jid = ?
         ORDER BY (messages + commands * 2) DESC
         LIMIT ?`,
      )
      .all(groupJid, safeLimit);
  }

  ensureEconomy(userJid) {
    return this.economy.ensureEconomy(userJid);
  }

  getEconomy(userJid) {
    return this.economy.getEconomy(userJid);
  }

  claimEconomy(userJid, field, cooldownSeconds, amount, now) {
    return this.economy.claimEconomy(userJid, field, cooldownSeconds, amount, now);
  }

  creditBalance(userJid, amount) {
    return this.economy.creditBalance(userJid, amount);
  }

  debitBalance(userJid, amount) {
    return this.economy.debitBalance(userJid, amount);
  }

  transferBalance(fromJid, toJid, amount) {
    return this.economy.transferBalance(fromJid, toJid, amount);
  }

  depositToBank(userJid, amount) {
    return this.economy.depositToBank(userJid, amount);
  }

  withdrawFromBank(userJid, amount) {
    return this.economy.withdrawFromBank(userJid, amount);
  }

  topBalances(limit = 10) {
    return this.economy.topBalances(limit);
  }

  economyStats() {
    return this.economy.economyStats();
  }

  addConfession(groupJid, content) {
    const result = this.db
      .prepare('INSERT INTO confessions (group_jid, content, created_at) VALUES (?, ?, ?)')
      .run(groupJid, String(content).slice(0, 1000), nowSeconds());
    return Number(result.lastInsertRowid);
  }

  getConfession(groupJid, id) {
    return (
      this.db
        .prepare('SELECT * FROM confessions WHERE group_jid = ? AND id = ?')
        .get(groupJid, id) || null
    );
  }

  countConfessions(groupJid) {
    return this.db
      .prepare('SELECT COUNT(*) AS count FROM confessions WHERE group_jid = ?')
      .get(groupJid).count;
  }

  claimMessage(messageId, chatJid) {
    const result = this.db
      .prepare('INSERT OR IGNORE INTO processed_messages (message_id, chat_jid, processed_at) VALUES (?, ?, ?)')
      .run(messageId, chatJid, nowSeconds());
    return result.changes === 1;
  }

  pruneProcessedMessages(maxAgeSeconds = 86400, now = nowSeconds()) {
    return this.db
      .prepare('DELETE FROM processed_messages WHERE processed_at < ?')
      .run(now - maxAgeSeconds).changes;
  }

  stats() {
    const scalar = (sql) => this.db.prepare(sql).get().count;
    const totals = this.db
      .prepare(
        'SELECT COALESCE(SUM(messages), 0) AS messages, COALESCE(SUM(commands), 0) AS commands FROM users',
      )
      .get();
    return {
      groups: scalar('SELECT COUNT(*) AS count FROM groups'),
      users: scalar('SELECT COUNT(*) AS count FROM users'),
      warnings: scalar('SELECT COUNT(*) AS count FROM warnings'),
      moderation: scalar('SELECT COUNT(*) AS count FROM moderation'),
      operators: scalar('SELECT COUNT(*) AS count FROM operators'),
      globalBans: scalar('SELECT COUNT(*) AS count FROM global_bans'),
      groupBans: scalar('SELECT COUNT(*) AS count FROM group_bans'),
      messages: totals.messages,
      commands: totals.commands,
    };
  }

  logAudit(actorJid, action, target = null, details = '') {
    this.db
      .prepare('INSERT INTO audits (actor_jid, action, target, details, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(actorJid || null, action, target || null, String(details || '').slice(0, 1000), nowSeconds());
  }
}
