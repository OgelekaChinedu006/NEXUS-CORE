import { nowSeconds } from '../helpers.js';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS quiz_cycles (
  user_jid TEXT NOT NULL,
  kind TEXT NOT NULL,
  remaining TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_jid, kind)
);
`;

export function shuffle(list, random = Math.random) {
  const items = Array.isArray(list) ? list.slice() : [];
  const rng = typeof random === 'function' ? random : Math.random;
  for (let index = items.length - 1; index > 0; index -= 1) {
    const swapWith = Math.floor(rng() * (index + 1));
    const current = items[index];
    items[index] = items[swapWith];
    items[swapWith] = current;
  }
  return items;
}

function asIdList(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const ids = [];
  for (const item of value) {
    if (typeof item !== 'string' || !item || seen.has(item)) continue;
    seen.add(item);
    ids.push(item);
  }
  return ids;
}

export function parseQuizCycle(raw) {
  if (!raw) return { remaining: [], cycle: [] };
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      const remaining = asIdList(parsed);
      return { remaining, cycle: remaining.slice() };
    }
    if (!parsed || typeof parsed !== 'object') return { remaining: [], cycle: [] };
    const remaining = asIdList(parsed.remaining ?? parsed.deck);
    const cycle = asIdList(parsed.cycle);
    return { remaining, cycle: cycle.length ? cycle : remaining.slice() };
  } catch {
    return { remaining: [], cycle: [] };
  }
}

function serializeQuizCycle(remaining, cycle) {
  return JSON.stringify({ remaining, cycle });
}

export function questionIds(bank) {
  const ids = [];
  const byId = new Map();
  if (!Array.isArray(bank)) return { ids, byId };
  for (const question of bank) {
    const id = typeof question?.prompt === 'string' ? question.prompt : '';
    if (!id || byId.has(id)) continue;
    byId.set(id, question);
    ids.push(id);
  }
  return { ids, byId };
}

export function reconcileQuizCycle(remaining, cycle, bankIds, random = Math.random) {
  const bankSet = new Set(bankIds);
  const nextRemaining = remaining.filter((id) => bankSet.has(id));
  const nextCycle = cycle.filter((id) => bankSet.has(id));
  const cycleSet = new Set(nextCycle);
  const added = bankIds.filter((id) => !cycleSet.has(id));
  if (added.length) {
    const shuffled = shuffle(added, random);
    nextRemaining.push(...shuffled);
    nextCycle.push(...shuffled);
  }
  return { remaining: nextRemaining, cycle: nextCycle };
}

export class QuizHistoryStore {
  static ensureSchema(db) {
    if (!db || typeof db.exec !== 'function') {
      throw new TypeError('A quiz history store needs a database handle.');
    }
    db.exec(SCHEMA);
  }

  constructor({ db, now = nowSeconds, transaction } = {}) {
    if (!db || typeof db.prepare !== 'function') {
      throw new TypeError('A quiz history store needs a database handle.');
    }
    QuizHistoryStore.ensureSchema(db);
    this.db = db;
    this.now = typeof now === 'function' ? now : nowSeconds;
    this.transaction =
      typeof transaction === 'function' ? transaction : (fn) => this.db.transaction(fn)();
  }

  getRemaining(userJid, kind) {
    const row = this.db
      .prepare('SELECT remaining FROM quiz_cycles WHERE user_jid = ? AND kind = ?')
      .get(userJid, kind);
    return parseQuizCycle(row?.remaining).remaining;
  }

  takeNext(userJid, kind, bank, random = Math.random) {
    const { ids: bankIds, byId } = questionIds(bank);
    if (!userJid || !kind || bankIds.length === 0) return undefined;

    const select = () => {
      const row = this.db
        .prepare('SELECT remaining FROM quiz_cycles WHERE user_jid = ? AND kind = ?')
        .get(userJid, kind);
      const state = parseQuizCycle(row?.remaining);
      let { remaining, cycle } = reconcileQuizCycle(state.remaining, state.cycle, bankIds, random);
      if (remaining.length === 0) {
        remaining = shuffle(bankIds, random);
        cycle = remaining.slice();
      }
      const id = remaining.shift();
      this.db
        .prepare(
          `INSERT INTO quiz_cycles (user_jid, kind, remaining, updated_at)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(user_jid, kind) DO UPDATE SET
             remaining = excluded.remaining,
             updated_at = excluded.updated_at`,
        )
        .run(userJid, kind, serializeQuizCycle(remaining, cycle), this.now());
      return byId.get(id);
    };

    if (typeof this.db.transaction === 'function') {
      const bound = this.db.transaction(select);
      if (typeof bound === 'function') {
        return typeof bound.immediate === 'function' ? bound.immediate() : bound();
      }
      return bound;
    }
    return this.transaction(select);
  }
}
