export const ACCESS_MODES = Object.freeze({
  VEIL: 'veil',
  AWAKEN: 'awaken',
  COVENANT: 'covenant',
});

export const DEFAULT_ACCESS_MODE = ACCESS_MODES.COVENANT;
export const ACCESS_MODE_SETTING = 'access_mode';

const KNOWN_MODES = new Set(Object.values(ACCESS_MODES));

export const ACCESS_MODE_DETAILS = Object.freeze({
  [ACCESS_MODES.VEIL]: 'Only the Sovereign is heard. Bound users and everyone else are silently ignored.',
  [ACCESS_MODES.COVENANT]: 'Only the Sovereign and bound users are heard. Everyone else is silently ignored.',
  [ACCESS_MODES.AWAKEN]: 'The vessel answers every soul, subject to existing command law.',
});

export function normalizeAccessMode(value) {
  const mode = String(value || '').trim().toLowerCase();
  return KNOWN_MODES.has(mode) ? mode : null;
}

export function getAccessMode(db) {
  const stored = db?.getSetting?.(ACCESS_MODE_SETTING, null);
  return normalizeAccessMode(stored) || DEFAULT_ACCESS_MODE;
}

export function setAccessMode(db, mode) {
  const normalized = normalizeAccessMode(mode);
  if (!normalized || !db) return null;
  db.setSetting(ACCESS_MODE_SETTING, normalized);
  return normalized;
}

export function allowsAccess(mode, { isOwner = false, isSudo = false } = {}) {
  const current = normalizeAccessMode(mode) || DEFAULT_ACCESS_MODE;
  if (current === ACCESS_MODES.VEIL) return Boolean(isOwner);
  if (current === ACCESS_MODES.COVENANT) return Boolean(isOwner || isSudo);
  if (current === ACCESS_MODES.AWAKEN) return true;
  return Boolean(isOwner || isSudo);
}
