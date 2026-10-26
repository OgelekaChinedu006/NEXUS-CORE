import { nowSeconds } from './helpers.js';

export const RUNE_NAMES = Object.freeze(['link', 'mention', 'spam', 'bot', 'call']);
export const RUNE_SET = new Set(RUNE_NAMES);

export const RUNE_MODES = Object.freeze(['mercy', 'grace', 'exile']);
export const RUNE_MODE_SET = new Set(RUNE_MODES);

export const BOT_RUNE_MODES = Object.freeze(['lockdown', 'crush']);
export const BOT_RUNE_MODE_SET = new Set(BOT_RUNE_MODES);

export const CALL_RUNE_MODES = Object.freeze(['mercy', 'grace', 'exile']);
export const CALL_RUNE_MODE_SET = new Set(CALL_RUNE_MODES);

export const RUNE_PUNISHMENTS = Object.freeze(['kick']);
export const RUNE_PUNISHMENT_SET = new Set(RUNE_PUNISHMENTS);

export const GLOBAL_RUNE_SCOPE = 'global';
export const GRACE_PUNISH_AT = 4;
export const CRUSH_JOIN_WINDOW_MS = 60_000;
export const CRUSH_PREFIX_WINDOW_MS = 6_000;
export const CRUSH_PREFIX_FLOOD_COUNT = 3;
export const CRUSH_MASS_MENTION_COUNT = 10;
export const CRUSH_PREFIXES = Object.freeze(['!', '.', '/', '#']);

export const INVITE_URL_PATTERN = /(?:https?:\/\/)?(?:www\.)?(?:chat\.whatsapp\.com|wa\.me)(?:\/[^\s<>"']*)?/i;
export const LINK_URL_PATTERN = /(?:https?:\/\/|www\.)[^\s<>"']+|\b(?:chat\.whatsapp\.com|wa\.me)(?:\/[^\s<>"']*)?/i;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS rune_settings (
  scope TEXT NOT NULL,
  rune TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 0,
  mode TEXT NOT NULL DEFAULT 'grace',
  punishment TEXT NOT NULL DEFAULT 'kick',
  submode TEXT,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (scope, rune)
);

CREATE TABLE IF NOT EXISTS rune_violations (
  scope TEXT NOT NULL,
  user_jid TEXT NOT NULL,
  rune TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  last_at INTEGER NOT NULL,
  PRIMARY KEY (scope, user_jid, rune)
);
CREATE INDEX IF NOT EXISTS idx_rune_violations_scope_rune ON rune_violations(scope, rune);

CREATE TABLE IF NOT EXISTS rune_events (
  event_id TEXT NOT NULL,
  rune TEXT NOT NULL,
  processed_at INTEGER NOT NULL,
  PRIMARY KEY (event_id, rune)
);
CREATE INDEX IF NOT EXISTS idx_rune_events_processed ON rune_events(processed_at);
`;

function asInt(value, fallback = 0) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeMode(rune, mode, fallback = 'grace') {
  const value = String(mode || '').trim().toLowerCase();
  if (rune === 'bot') {
    if (value === 'crushzone' || value === 'crush-zone' || value === 'crush_zone') return 'crush';
    return BOT_RUNE_MODE_SET.has(value) ? value : fallback === 'grace' ? 'lockdown' : fallback;
  }
  if (rune === 'call') {
    return CALL_RUNE_MODE_SET.has(value) ? value : fallback === 'grace' ? 'mercy' : fallback;
  }
  return RUNE_MODE_SET.has(value) ? value : fallback;
}

function normalizePunishment(value, fallback = 'kick') {
  const punishment = String(value || '').trim().toLowerCase();
  return RUNE_PUNISHMENT_SET.has(punishment) ? punishment : fallback;
}

function defaultMode(rune) {
  if (rune === 'bot') return 'lockdown';
  if (rune === 'call') return 'mercy';
  return 'grace';
}

export function isKnownRune(rune) {
  return RUNE_SET.has(String(rune || '').toLowerCase());
}

export class RuneStore {
  static ensureSchema(db) {
    if (!db || typeof db.exec !== 'function') {
      throw new TypeError('A rune store needs a database handle.');
    }
    db.exec(SCHEMA);
  }

  constructor({ db, now = nowSeconds, transaction } = {}) {
    if (!db || typeof db.prepare !== 'function') {
      throw new TypeError('A rune store needs a database handle.');
    }
    RuneStore.ensureSchema(db);
    this.db = db;
    this.now = typeof now === 'function' ? now : nowSeconds;
    this.transaction =
      typeof transaction === 'function' ? transaction : (fn) => this.db.transaction(fn)();
  }

  getSetting(scope, rune) {
    return (
      this.db
        .prepare('SELECT * FROM rune_settings WHERE scope = ? AND rune = ?')
        .get(scope, rune) || null
    );
  }

  listSettings(scope) {
    return this.db.prepare('SELECT * FROM rune_settings WHERE scope = ? ORDER BY rune ASC').all(scope);
  }

  setSetting(scope, rune, patch = {}) {
    const current = this.getSetting(scope, rune);
    const enabled = patch.enabled === undefined
      ? (current ? asInt(current.enabled) : 0)
      : (patch.enabled ? 1 : 0);
    const mode = normalizeMode(
      rune,
      patch.mode === undefined ? current?.mode : patch.mode,
      defaultMode(rune),
    );
    const punishment = normalizePunishment(
      patch.punishment === undefined ? current?.punishment : patch.punishment,
      'kick',
    );
    const submode = patch.submode === undefined
      ? (current?.submode ?? null)
      : (patch.submode == null ? null : String(patch.submode));
    const updatedAt = this.now();
    this.db
      .prepare(
        `INSERT INTO rune_settings (scope, rune, enabled, mode, punishment, submode, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(scope, rune) DO UPDATE SET
           enabled = excluded.enabled,
           mode = excluded.mode,
           punishment = excluded.punishment,
           submode = excluded.submode,
           updated_at = excluded.updated_at`,
      )
      .run(scope, rune, enabled, mode, punishment, submode, updatedAt);
    return this.getSetting(scope, rune);
  }

  getViolation(scope, userJid, rune) {
    return (
      this.db
        .prepare('SELECT * FROM rune_violations WHERE scope = ? AND user_jid = ? AND rune = ?')
        .get(scope, userJid, rune) || null
    );
  }

  getViolationCount(scope, userJid, rune) {
    return asInt(this.getViolation(scope, userJid, rune)?.count, 0);
  }

  incrementViolation(scope, userJid, rune, at = this.now()) {
    this.db
      .prepare(
        `INSERT INTO rune_violations (scope, user_jid, rune, count, last_at)
         VALUES (?, ?, ?, 1, ?)
         ON CONFLICT(scope, user_jid, rune) DO UPDATE SET
           count = count + 1,
           last_at = excluded.last_at`,
      )
      .run(scope, userJid, rune, at);
    return this.getViolation(scope, userJid, rune);
  }

  resetViolation(scope, userJid, rune) {
    return this.db
      .prepare('DELETE FROM rune_violations WHERE scope = ? AND user_jid = ? AND rune = ?')
      .run(scope, userJid, rune).changes;
  }

  claimEvent(eventId, rune, at = this.now()) {
    const result = this.db
      .prepare('INSERT OR IGNORE INTO rune_events (event_id, rune, processed_at) VALUES (?, ?, ?)')
      .run(eventId, rune, at);
    return result.changes === 1;
  }

  hasEvent(eventId, rune) {
    return Boolean(
      this.db
        .prepare('SELECT 1 AS ok FROM rune_events WHERE event_id = ? AND rune = ?')
        .get(eventId, rune),
    );
  }

  releaseEvent(eventId, rune) {
    return this.db
      .prepare('DELETE FROM rune_events WHERE event_id = ? AND rune = ?')
      .run(eventId, rune).changes;
  }

  pruneEvents(maxAgeSeconds = 86400, now = this.now()) {
    return this.db
      .prepare("DELETE FROM rune_events WHERE processed_at < ? AND event_id NOT LIKE 'mercy:%'")
      .run(now - maxAgeSeconds).changes;
  }
}

export function resolveRuneSetting(db, scope, rune) {
  const stored = db?.runes?.getSetting?.(scope, rune) || null;
  if (stored) {
    return {
      scope,
      rune,
      enabled: Boolean(asInt(stored.enabled)),
      mode: normalizeMode(rune, stored.mode, defaultMode(rune)),
      punishment: normalizePunishment(stored.punishment),
      submode: stored.submode || null,
      source: 'rune',
      updatedAt: stored.updated_at,
    };
  }

  if (rune === 'link' || rune === 'spam') {
    const group = typeof db?.getGroup === 'function' ? db.getGroup(scope) : null;
    const flag = rune === 'link' ? group?.antilink : group?.antispam;
    if (group && flag !== undefined && flag !== null) {
      return {
        scope,
        rune,
        enabled: Boolean(asInt(flag)),
        mode: 'grace',
        punishment: 'kick',
        submode: null,
        source: 'legacy',
        updatedAt: group.updated_at || null,
      };
    }
  }

  return {
    scope,
    rune,
    enabled: false,
    mode: defaultMode(rune),
    punishment: 'kick',
    submode: null,
    source: 'default',
    updatedAt: null,
  };
}

export function describeRuneSetting(setting) {
  if (!setting?.enabled) return 'DORMANT';
  const mode = String(setting.mode || '').toUpperCase();
  if (setting.rune === 'bot' || setting.rune === 'call') return `ACTIVE (${mode})`;
  return `ACTIVE (${mode} / ${String(setting.punishment || 'kick').toUpperCase()})`;
}
