import { normalizeJid, toUserJid } from './helpers.js';

const ALIAS_FIELDS = ['id', 'lid', 'jid', 'phoneNumber', 'lidJid'];

// Only `phoneNumber` is, by name, a phone. A strictly digits-only value there
// is converted with the project's existing toUserJid convention
// (`<digits>@s.whatsapp.net`, 7-20 digits). No country code is added, and
// bare digits in any other field (id, lid, ...) are never converted because
// they could be a LID.
function aliasFromField(field, value) {
  if (field === 'phoneNumber' && typeof value === 'string' && /^\d+$/.test(value.trim())) {
    return toUserJid(value.trim());
  }
  return normalizeJid(value);
}

/**
 * Every normalized JID a group participant may be known by.
 * Missing, empty or non-JID fields are skipped. Order follows ALIAS_FIELDS
 * and duplicates are removed.
 */
export function participantAliases(participant) {
  if (!participant || typeof participant !== 'object') return [];
  const aliases = [];
  for (const field of ALIAS_FIELDS) {
    const normalized = aliasFromField(field, participant[field]);
    if (normalized && !aliases.includes(normalized)) aliases.push(normalized);
  }
  return aliases;
}

/**
 * Resolve a JID to the normalized `id` of the group participant that owns it
 * (matching on any alias), so LID and phone forms of one user compare equal.
 * Falls back to the normalized input JID when there is no group metadata or
 * no participant matches. Matching is exact on normalized JIDs only.
 */
export function canonicalUserJid(groupMeta, jid) {
  const target = normalizeJid(jid);
  if (!target) return null;
  const participants = Array.isArray(groupMeta?.participants) ? groupMeta.participants : [];
  for (const participant of participants) {
    if (participantAliases(participant).includes(target)) {
      return normalizeJid(participant.id) || target;
    }
  }
  return target;
}

/** True when both JIDs resolve to the same canonical user. */
export function sameUser(groupMeta, a, b) {
  const first = canonicalUserJid(groupMeta, a);
  const second = canonicalUserJid(groupMeta, b);
  return Boolean(first && second && first === second);
}

/**
 * Every known identity for a JID: the JID itself plus participant LID/phone aliases.
 */
export function identityJids(groupMeta, jid) {
  const target = normalizeJid(jid);
  if (!target) return [];
  const found = [];
  const add = (value) => {
    const normalized = normalizeJid(value);
    if (normalized && !found.includes(normalized)) found.push(normalized);
  };
  add(target);
  const participants = Array.isArray(groupMeta?.participants) ? groupMeta.participants : [];
  for (const participant of participants) {
    const aliases = participantAliases(participant);
    if (aliases.includes(target)) {
      for (const alias of aliases) add(alias);
    }
  }
  return found;
}

export function identitiesOverlap(left = [], right = []) {
  if (!left.length || !right.length) return false;
  const pool = new Set(right);
  return left.some((jid) => pool.has(jid));
}

export function sessionIdentityJids(user) {
  if (!user || typeof user !== 'object') return [];
  const jids = [];
  const add = (value, field = 'id') => {
    const normalized = aliasFromField(field, value);
    if (normalized && !jids.includes(normalized)) jids.push(normalized);
  };
  add(user.id);
  add(user.lid);
  add(user.jid);
  add(user.lidJid);
  add(user.phoneNumber, 'phoneNumber');
  return jids;
}
