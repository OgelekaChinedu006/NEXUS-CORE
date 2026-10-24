import { getContentType } from '@whiskeysockets/baileys';
import { formatTimestamp, isUserJid, normalizeJid, sanitizeField } from './helpers.js';
import {
  downloadViewOnceBuffer,
  inspectViewOnceMessage,
  toSendContent,
} from './view-once.js';

export const HORUS_VANISH_SETTING = 'horus_vanish';
export const HORUS_ERASE_SETTING = 'horus_erase';
export const REVOKE_STUB = 1;
export const ADMIN_REVOKE_STUB = 132;

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const CACHE_LIMIT = 500;
const PROTOCOL_REVOKE = 0;

const OTHER_WRAPPERS = [
  'ephemeralMessage',
  'viewOnceMessage',
  'viewOnceMessageV2',
  'viewOnceMessageV2Extension',
  'documentWithCaptionMessage',
  'editedMessage',
  'deviceSentMessage',
];

const MEDIA_KINDS = Object.freeze({
  imageMessage: { kind: 'image', downloadType: 'image' },
  videoMessage: { kind: 'video', downloadType: 'video' },
  audioMessage: { kind: 'audio', downloadType: 'audio' },
});

function unwrapContent(message) {
  let current = message;
  for (let depth = 0; depth <= 6; depth += 1) {
    if (!current || typeof current !== 'object') break;
    const key = OTHER_WRAPPERS.find((name) => current[name]?.message);
    if (!key) break;
    current = current[key].message;
  }
  return current;
}

function settingOn(db, key) {
  return Boolean(db?.getSettingBool?.(key, false));
}

export function peekOwnerJid(config) {
  const ownerJid = normalizeJid(config?.ownerJid);
  if (!ownerJid || !isUserJid(ownerJid)) return null;
  return ownerJid;
}

export function readHorusState(db, config) {
  const vanishStored = settingOn(db, HORUS_VANISH_SETTING);
  const eraseStored = settingOn(db, HORUS_ERASE_SETTING);
  const ownerJid = peekOwnerJid(config);
  const ownerConfigured = Boolean(ownerJid);
  return {
    vanishStored,
    eraseStored,
    ownerConfigured,
    ownerJid,
    vanishEffective: vanishStored && ownerConfigured,
    eraseEffective: eraseStored && ownerConfigured,
    joint: vanishStored && eraseStored,
  };
}

export function setHorusWatch(db, key, enabled) {
  db.setSetting(key, enabled ? '1' : '0');
}

export function setHorusJoint(db, enabled) {
  const value = enabled ? '1' : '0';
  db.transaction(() => {
    db.setSetting(HORUS_VANISH_SETTING, value);
    db.setSetting(HORUS_ERASE_SETTING, value);
  });
}

export function renderHorusMenu(state) {
  const vanishStatus = state.vanishEffective ? 'ON' : 'OFF';
  const eraseStatus = state.eraseEffective ? 'ON' : 'OFF';
  const vanishDest = state.ownerConfigured ? 'Owner DM' : 'unconfigured';
  const eraseDest = state.ownerConfigured ? 'Owner DM' : 'unconfigured';
  return [
    '╭━━『 EYE OF HORUS 』━━╮',
    '┃ System Status: ACTIVE',
    '┃ Category: Sovereign',
    '┃ ━━ VANISHING WATCH ━━',
    `┃ Status: ${vanishStatus}`,
    `┃ Destination: ${vanishDest}`,
    '┃ ━━ ERASURE WATCH ━━',
    `┃ Status: ${eraseStatus}`,
    `┃ Destination: ${eraseDest}`,
    '┃ ━━ SYSTEM CONTROLS ━━',
    '┃ !horus vanish on',
    '┃ !horus vanish off',
    '┃ !horus erase on',
    '┃ !horus erase off',
    '┃ !horus joint on',
    '┃ !horus joint off',
    '┃ !horus status',
    '╰━━━━━━━━━━━━━━━━━━━━╯',
  ].join('\n');
}

export function renderHorusStatus(state) {
  let joint = 'OFF';
  if (state.vanishStored && state.eraseStored) joint = 'ON';
  else if (state.vanishStored || state.eraseStored) joint = 'PARTIAL';
  const destination = state.ownerConfigured ? 'Owner DM' : 'unconfigured';
  const vanishNote = !state.ownerConfigured && state.vanishStored ? ' (owner JID missing)' : '';
  const eraseNote = !state.ownerConfigured && state.eraseStored ? ' (owner JID missing)' : '';
  return [
    '╭━━『 EYE OF HORUS 』━━╮',
    '┃ System Status: ACTIVE',
    '┃ Category: Sovereign',
    `┃ Vanishing Watch: ${state.vanishStored ? 'ON' : 'OFF'}${vanishNote}`,
    `┃ Erasure Watch: ${state.eraseStored ? 'ON' : 'OFF'}${eraseNote}`,
    `┃ Joint: ${joint}`,
    `┃ Destination: ${destination}`,
    '╰━━━━━━━━━━━━━━━━━━━━╯',
  ].join('\n');
}

export function messageCacheKey(chatJid, messageId) {
  if (!chatJid || !messageId) return null;
  return `${chatJid}:${messageId}`;
}

export function extractRevokeFromMessage(msg) {
  const protocol = unwrapContent(msg?.message)?.protocolMessage;
  if (!protocol) return null;
  const type = protocol.type;
  if (type !== PROTOCOL_REVOKE && type !== 'REVOKE') return null;
  const id = protocol.key?.id;
  const chatJid = protocol.key?.remoteJid || msg?.key?.remoteJid;
  if (!id || !chatJid) return null;
  return {
    id,
    chatJid,
    participant: normalizeJid(protocol.key?.participant || msg?.key?.participant),
    fromMe: Boolean(protocol.key?.fromMe ?? msg?.key?.fromMe),
    stubType: REVOKE_STUB,
  };
}

export function extractRevokeFromUpdate(entry) {
  if (!entry?.key?.id || !entry.key.remoteJid) return null;
  const stub = entry.update?.messageStubType;
  const revoked =
    stub === REVOKE_STUB ||
    stub === ADMIN_REVOKE_STUB ||
    stub === 'REVOKE' ||
    stub === 'ADMIN_REVOKE' ||
    (entry.update && Object.prototype.hasOwnProperty.call(entry.update, 'message') && entry.update.message === null);
  if (!revoked) return null;
  return {
    id: entry.key.id,
    chatJid: entry.key.remoteJid,
    participant: normalizeJid(entry.key.participant),
    fromMe: Boolean(entry.key.fromMe),
    stubType: stub ?? REVOKE_STUB,
  };
}

function mediaKindFromContent(message) {
  const viewOnce = inspectViewOnceMessage(message);
  if (viewOnce.ok) return viewOnce;
  const unwrapped = unwrapContent(message);
  const type = getContentType(unwrapped || {});
  const spec = type ? MEDIA_KINDS[type] : null;
  const media = spec ? unwrapped[type] : null;
  if (spec && media && typeof media === 'object') {
    const ptt = type === 'audioMessage' && Boolean(media.ptt);
    return {
      ok: true,
      kind: ptt ? 'voice' : spec.kind,
      downloadType: spec.downloadType,
      type,
      media,
      mimetype: typeof media.mimetype === 'string' && media.mimetype ? media.mimetype : undefined,
      caption: typeof media.caption === 'string' && media.caption ? media.caption : undefined,
      ptt,
    };
  }
  return { ok: false };
}

function extractText(message) {
  const unwrapped = unwrapContent(message);
  if (!unwrapped) return '';
  const type = getContentType(unwrapped);
  if (!type) return '';
  const content = unwrapped[type];
  if (typeof content === 'string') return content;
  return content?.text || content?.caption || content?.conversation || '';
}

function toUnixSeconds(value) {
  if (value === null || value === undefined || value === '') return null;
  const numeric = typeof value === 'object' && value !== null && 'toNumber' in value ? value.toNumber() : Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  return numeric > 1e12 ? Math.floor(numeric / 1000) : Math.floor(numeric);
}

function formatTime(seconds, config) {
  if (!seconds) return null;
  return formatTimestamp(seconds, {
    locale: config?.locale || 'en-GB',
    timezone: config?.timezone || 'UTC',
  });
}

function contextLines({ title, chatJid, senderJid, timestamp, extra, config }) {
  const lines = [title];
  if (chatJid) lines.push(`Origin: ${sanitizeField(chatJid, 80)}`);
  if (senderJid) lines.push(`Sender: ${sanitizeField(senderJid, 80)}`);
  const time = formatTime(timestamp, config);
  if (time && time !== 'unknown') lines.push(`Time: ${time}`);
  if (extra) lines.push(sanitizeField(extra, 300));
  return lines.join('\n');
}

async function sendOwner(socket, ownerJid, content) {
  if (!ownerJid || typeof socket?.sendMessage !== 'function') return false;
  const result = await socket.sendMessage(ownerJid, content);
  return result != null;
}

export function createHorusMonitor({ db, config, logger, downloadMedia } = {}) {
  return new HorusMonitor({ db, config, logger, downloadMedia });
}

export class HorusMonitor {
  constructor({ db, config, logger, downloadMedia } = {}) {
    this.db = db;
    this.config = config;
    this.logger = logger;
    this.downloadMedia = downloadMedia || downloadViewOnceBuffer;
    this.cache = new Map();
    this.vanishSeen = new Map();
    this.eraseSeen = new Map();
    this.pending = new Set();
  }

  state() {
    return readHorusState(this.db, this.config);
  }

  prune(now = Date.now()) {
    for (const [key, entry] of this.cache) {
      if (!entry?.expiresAt || entry.expiresAt <= now) this.cache.delete(key);
    }
    for (const [key, expiresAt] of this.vanishSeen) {
      if (expiresAt <= now) this.vanishSeen.delete(key);
    }
    for (const [key, expiresAt] of this.eraseSeen) {
      if (expiresAt <= now) this.eraseSeen.delete(key);
    }
    while (this.cache.size > CACHE_LIMIT) {
      const oldest = this.cache.keys().next().value;
      this.cache.delete(oldest);
    }
  }

  waitForIdle() {
    if (!this.pending.size) return Promise.resolve();
    return Promise.allSettled([...this.pending]).then(() => undefined);
  }

  track(work) {
    const task = Promise.resolve(work)
      .catch((error) => {
        this.logger?.warn?.(`Horus watch failed: ${error.message}`);
      })
      .finally(() => {
        this.pending.delete(task);
      });
    this.pending.add(task);
    return task;
  }

  observeUpsert(socket, msg, { chatJid, senderJid, fromMe } = {}) {
    try {
      if (!msg?.key?.id) return;
      const remote = chatJid || msg.key.remoteJid;
      if (!remote || remote === 'status@broadcast' || remote.endsWith('@broadcast') || remote.endsWith('@newsletter')) {
        return;
      }
      if (fromMe || msg.key.fromMe) return;

      const revoke = extractRevokeFromMessage(msg);
      if (revoke) {
        this.track(this.reportErasure(socket, revoke));
        return;
      }

      const state = this.state();
      if (state.eraseStored) this.cacheIncoming(msg, remote, senderJid);
      if (state.vanishEffective) this.track(this.captureVanishing(socket, msg, remote, senderJid));
    } catch (error) {
      this.logger?.warn?.(`Horus observe failed: ${error.message}`);
    }
  }

  handleUpdates(socket, updates) {
    if (!Array.isArray(updates)) return Promise.resolve();
    const jobs = [];
    for (const entry of updates) {
      try {
        const revoke = extractRevokeFromUpdate(entry);
        if (revoke) jobs.push(this.reportErasure(socket, revoke));
      } catch (error) {
        this.logger?.warn?.(`Horus update inspect failed: ${error.message}`);
      }
    }
    if (!jobs.length) return Promise.resolve();
    const task = Promise.allSettled(jobs);
    this.track(task);
    return task;
  }

  cacheIncoming(msg, chatJid, senderJid) {
    const key = messageCacheKey(chatJid, msg.key.id);
    if (!key) return;
    const expiresAt = Date.now() + CACHE_TTL_MS;
    this.cache.set(key, {
      expiresAt,
      chatJid,
      id: msg.key.id,
      senderJid: senderJid || normalizeJid(msg.key.participant) || (!chatJid.endsWith('@g.us') ? normalizeJid(chatJid) : null),
      timestamp: toUnixSeconds(msg.messageTimestamp),
      message: msg.message || null,
    });
    this.prune();
  }

  takeCached(chatJid, id) {
    const key = messageCacheKey(chatJid, id);
    if (!key) return null;
    const entry = this.cache.get(key) || null;
    if (entry) this.cache.delete(key);
    return entry;
  }

  markSeen(map, key) {
    if (!key) return false;
    this.prune();
    if (map.has(key)) return false;
    map.set(key, Date.now() + CACHE_TTL_MS);
    return true;
  }

  async captureVanishing(socket, msg, chatJid, senderJid) {
    const state = this.state();
    if (!state.vanishEffective) return;
    const inspected = inspectViewOnceMessage(msg.message);
    if (!inspected.ok) return;
    const seenKey = messageCacheKey(chatJid, msg.key.id);
    if (!this.markSeen(this.vanishSeen, seenKey)) return;

    let buffer;
    try {
      buffer = await this.downloadMedia(inspected, {
        sock: socket,
        quotedMessage: msg.message,
        logger: this.logger,
      });
    } catch (error) {
      this.logger?.warn?.(`Vanishing Watch download failed: ${error.message}`);
      return;
    }
    if (!Buffer.isBuffer(buffer) || !buffer.length) return;

    const caption = contextLines({
      title: `Vanishing Watch: ${inspected.kind}`,
      chatJid,
      senderJid,
      timestamp: toUnixSeconds(msg.messageTimestamp),
      extra: inspected.caption,
      config: this.config,
    });
    const recovered = { ...inspected, buffer };
    const mediaContent = toSendContent(recovered, {
      caption: recovered.kind === 'audio' || recovered.kind === 'voice' ? undefined : caption,
    });
    const delivered = await sendOwner(socket, state.ownerJid, mediaContent);
    if (!delivered) return;
    if (recovered.kind === 'audio' || recovered.kind === 'voice') {
      await sendOwner(socket, state.ownerJid, { text: caption }).catch(() => {});
    }
  }

  async reportErasure(socket, revoke) {
    const state = this.state();
    if (!state.eraseEffective) return;
    if (revoke.fromMe) return;
    const seenKey = messageCacheKey(revoke.chatJid, revoke.id);
    if (!this.markSeen(this.eraseSeen, seenKey)) return;

    const cached = this.takeCached(revoke.chatJid, revoke.id);
    const senderJid = cached?.senderJid || revoke.participant;
    const heading = contextLines({
      title: 'Erasure Watch',
      chatJid: revoke.chatJid,
      senderJid,
      timestamp: cached?.timestamp,
      extra: cached ? `Type: ${describeCachedType(cached.message)}` : 'Original content was not cached.',
      config: this.config,
    });

    if (!cached?.message) {
      await sendOwner(socket, state.ownerJid, { text: heading });
      return;
    }

    const media = mediaKindFromContent(cached.message);
    if (media.ok) {
      let buffer;
      try {
        buffer = await this.downloadMedia(media, {
          sock: socket,
          quotedMessage: cached.message,
          logger: this.logger,
        });
      } catch (error) {
        this.logger?.warn?.(`Erasure Watch media download failed: ${error.message}`);
      }
      if (Buffer.isBuffer(buffer) && buffer.length) {
        const recovered = { ...media, buffer };
        const caption = `${heading}${media.caption ? `\n${sanitizeField(media.caption, 300)}` : ''}`;
        const content = toSendContent(recovered, {
          caption: recovered.kind === 'audio' || recovered.kind === 'voice' ? undefined : caption,
        });
        const delivered = await sendOwner(socket, state.ownerJid, content);
        if (delivered && (recovered.kind === 'audio' || recovered.kind === 'voice')) {
          await sendOwner(socket, state.ownerJid, { text: caption }).catch(() => {});
        }
        if (delivered) return;
      }
    }

    const text = extractText(cached.message);
    if (text) {
      await sendOwner(socket, state.ownerJid, { text: `${heading}\n\n${sanitizeField(text, 2000)}` });
      return;
    }

    await sendOwner(socket, state.ownerJid, {
      text: `${heading}\nThe original message could not be recovered.`,
    });
  }
}

function describeCachedType(message) {
  const media = mediaKindFromContent(message);
  if (media.ok) return media.kind;
  const text = extractText(message);
  if (text) return 'text';
  const type = getContentType(unwrapContent(message) || {});
  return type || 'unknown';
}
