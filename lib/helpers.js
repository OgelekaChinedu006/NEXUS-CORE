import crypto from 'node:crypto';

export class CommandError extends Error {
  constructor(message, { expose = true, code = 'COMMAND_ERROR' } = {}) {
    super(message);
    this.name = 'CommandError';
    this.expose = expose;
    this.code = code;
  }
}

export function normalizeJid(jid) {
  if (!jid || typeof jid !== 'string') return null;
  const trimmed = jid.trim();
  if (!trimmed.includes('@')) return null;
  const [user, domain] = trimmed.split('@');
  if (!user || !domain) return null;
  return `${user.split(':')[0]}@${domain}`;
}

export function jidNumber(jid) {
  const normalized = normalizeJid(jid);
  return normalized ? normalized.split('@')[0] : '';
}

export function displayMention(jid) {
  const number = jidNumber(jid);
  return number ? `@${number}` : '@unknown';
}

export function isGroupJid(jid) {
  return Boolean(jid && jid.endsWith('@g.us'));
}

export function isUserJid(jid) {
  return Boolean(jid && (jid.endsWith('@s.whatsapp.net') || jid.endsWith('@lid')));
}

export function toUserJid(value) {
  if (!value) return null;
  const trimmed = String(value).trim();
  if (/^[^@\s]+@[^@\s]+$/.test(trimmed)) return normalizeJid(trimmed);
  const digits = trimmed.replace(/[^\d]/g, '');
  if (digits.length >= 7 && digits.length <= 20) return `${digits}@s.whatsapp.net`;
  return null;
}

export function sanitizeField(value, maxLength = 500) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/\r\n/g, '\n')
    .trim()
    .slice(0, maxLength);
}

export function truncate(value, maxLength = 300) {
  const text = String(value ?? '');
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 1))}…`;
}

export function formatDuration(ms) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const parts = [];
  if (days) parts.push(`${days}d`);
  if (hours) parts.push(`${hours}h`);
  if (minutes) parts.push(`${minutes}m`);
  if (seconds || parts.length === 0) parts.push(`${seconds}s`);
  return parts.join(' ');
}

export function formatBytes(bytes) {
  const value = Number(bytes) || 0;
  if (value < 1024) return `${value} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let size = value / 1024;
  let index = 0;
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024;
    index += 1;
  }
  return `${size.toFixed(1)} ${units[index]}`;
}

export function hashSeed(value) {
  return crypto.createHash('sha256').update(String(value)).digest().readUInt32BE(0);
}

export function seededRandom(seed) {
  let state = (Number(seed) || 1) >>> 0;
  return function next() {
    state += 0x6d2b79f5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function randomInt(min, max, random = Math.random) {
  const low = Math.ceil(Math.min(min, max));
  const high = Math.floor(Math.max(min, max));
  return Math.floor(random() * (high - low + 1)) + low;
}

export function pick(list, random = Math.random) {
  if (!Array.isArray(list) || list.length === 0) return undefined;
  return list[Math.floor(random() * list.length)];
}

export function chunk(list, size) {
  const output = [];
  for (let index = 0; index < list.length; index += size) {
    output.push(list.slice(index, index + size));
  }
  return output;
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function parseAmount(value, { min = 1, max = 10_000_000 } = {}) {
  const normalized = String(value ?? '').replace(/,/g, '');
  if (!/^\d+$/.test(normalized)) return null;
  const amount = Number(normalized);
  if (!Number.isSafeInteger(amount) || amount < min || amount > max) return null;
  return amount;
}

export function isHttpUrl(value) {
  try {
    const url = new URL(String(value));
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function withTimeout(promise, timeoutMs, message = 'Operation timed out') {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new CommandError(message)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

export function formatTimestamp(seconds, { locale = 'en-GB', timezone = 'UTC' } = {}) {
  const date = new Date(Number(seconds) * 1000);
  if (Number.isNaN(date.getTime())) return 'unknown';
  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: timezone,
  }).format(date);
}
