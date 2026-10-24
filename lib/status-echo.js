import { downloadContentFromMessage, downloadMediaMessage, getContentType } from '@whiskeysockets/baileys';
import { CommandError, isUserJid, normalizeJid, sanitizeField } from './helpers.js';
import { deliverToChat, deliverToOwner, resolveOwnerDestination } from './view-once.js';

export const STATUS_BROADCAST_JID = 'status@broadcast';
export const DEFAULT_STATUS_CACHE_LIMIT = 32;
export const DEFAULT_STATUS_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export const ECHO_USAGE = 'Use echo soul to send the viewed status to the owner DM, or echo realm to send it here.';
export const ECHO_UNAVAILABLE = 'No viewed status is available to retrieve.';
export const ECHO_NOT_STATUS = 'Reply to a viewed status, or view a status first.';
export const ECHO_UNSUPPORTED = 'That status type cannot be retrieved.';
export const ECHO_MISSING_MEDIA = 'That status has no retrievable media.';
export const ECHO_RETRIEVAL_FAILED = 'The status media could not be retrieved. It may be inaccessible or expired.';

const OTHER_WRAPPERS = [
  'ephemeralMessage',
  'documentWithCaptionMessage',
  'editedMessage',
  'deviceSentMessage',
  'viewOnceMessage',
  'viewOnceMessageV2',
  'viewOnceMessageV2Extension',
];

const MEDIA_TYPES = Object.freeze({
  imageMessage: { kind: 'image', downloadType: 'image' },
  videoMessage: { kind: 'video', downloadType: 'video' },
  audioMessage: { kind: 'audio', downloadType: 'audio' },
});

function unwrapStatusMessage(message) {
  let current = message;
  for (let depth = 0; depth <= 6; depth += 1) {
    if (!current || typeof current !== 'object') break;
    const wrapper = OTHER_WRAPPERS.find((key) => current[key]?.message);
    if (!wrapper) break;
    current = current[wrapper].message;
  }
  return current;
}

function isUsableBuffer(value) {
  return Buffer.isBuffer(value) && value.length > 0;
}

function silentLogger() {
  const logger = {
    info() {},
    warn() {},
    error() {},
    debug() {},
    child() {
      return logger;
    },
  };
  return logger;
}

async function streamToBuffer(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks);
}

export function isStatusBroadcastJid(jid) {
  return jid === STATUS_BROADCAST_JID;
}

export function parseEchoMode(value) {
  const mode = String(value || '').trim().toLowerCase();
  if (mode === 'soul' || mode === 'realm') return mode;
  return null;
}

export function hasDownloadableMedia(media) {
  if (!media || typeof media !== 'object') return false;
  return Boolean(media.mediaKey || media.directPath || media.url);
}

export function inspectStatusMessage(message) {
  if (!message || typeof message !== 'object') {
    return { ok: false, reason: ECHO_UNSUPPORTED };
  }

  const content = unwrapStatusMessage(message);
  const type = getContentType(content || {});
  if (!type) return { ok: false, reason: ECHO_UNSUPPORTED };

  if (type === 'conversation') {
    const text = typeof content.conversation === 'string' ? content.conversation.trim() : '';
    if (!text) return { ok: false, reason: ECHO_UNAVAILABLE };
    return { ok: true, kind: 'text', type, text, media: null };
  }

  if (type === 'extendedTextMessage') {
    const text = typeof content.extendedTextMessage?.text === 'string'
      ? content.extendedTextMessage.text.trim()
      : '';
    if (!text) return { ok: false, reason: ECHO_UNAVAILABLE };
    return { ok: true, kind: 'text', type, text, media: null };
  }

  const spec = MEDIA_TYPES[type];
  const media = spec ? content[type] : null;
  if (!spec || !media || typeof media !== 'object') {
    return { ok: false, reason: ECHO_UNSUPPORTED };
  }

  const ptt = type === 'audioMessage' && Boolean(media.ptt);
  return {
    ok: true,
    kind: ptt ? 'voice' : spec.kind,
    downloadType: spec.downloadType,
    type,
    media,
    mimetype: typeof media.mimetype === 'string' && media.mimetype ? media.mimetype : undefined,
    caption: typeof media.caption === 'string' && media.caption.trim() ? media.caption : undefined,
    text: undefined,
    ptt,
  };
}

export function createStatusCache({
  maxEntries = DEFAULT_STATUS_CACHE_LIMIT,
  ttlMs = DEFAULT_STATUS_CACHE_TTL_MS,
  now = Date.now,
} = {}) {
  const entries = new Map();
  const limit = Math.max(1, Number(maxEntries) || DEFAULT_STATUS_CACHE_LIMIT);
  const ttl = Math.max(1, Number(ttlMs) || DEFAULT_STATUS_CACHE_TTL_MS);

  function prune(at = now()) {
    for (const [id, entry] of entries) {
      if (!entry || entry.expiresAt <= at) entries.delete(id);
    }
    return entries.size;
  }

  function put(record) {
    if (!record?.id) return null;
    const storedAt = now();
    prune(storedAt);
    if (entries.has(record.id)) entries.delete(record.id);
    while (entries.size >= limit) {
      const oldest = entries.keys().next().value;
      entries.delete(oldest);
    }
    const entry = {
      ...record,
      storedAt,
      expiresAt: storedAt + ttl,
    };
    entries.set(record.id, entry);
    return entry;
  }

  function get(id) {
    if (!id) return null;
    prune();
    const entry = entries.get(id) || null;
    if (!entry) return null;
    if (entry.expiresAt <= now()) {
      entries.delete(id);
      return null;
    }
    return entry;
  }

  function latest() {
    prune();
    let newest = null;
    for (const entry of entries.values()) newest = entry;
    return newest;
  }

  function observe(msg) {
    return observeStatusMessage({ put }, msg);
  }

  return {
    get maxEntries() {
      return limit;
    },
    get ttlMs() {
      return ttl;
    },
    get size() {
      prune();
      return entries.size;
    },
    put,
    get,
    latest,
    prune,
    observe,
    entries,
  };
}

export function observeStatusMessage(cache, msg) {
  const key = msg?.key;
  if (!key?.id || !isStatusBroadcastJid(key.remoteJid)) return null;
  const inspected = inspectStatusMessage(msg.message);
  if (!inspected.ok) return null;
  const authorJid = normalizeJid(key.participant);
  return cache.put({
    id: key.id,
    authorJid,
    key,
    message: msg.message,
    messageTimestamp: Number(msg.messageTimestamp) || undefined,
    inspected,
  });
}

function quotedPointsAtStatus(quoted, cached) {
  if (cached) return true;
  return isStatusBroadcastJid(quoted?.remoteJid);
}

function recordFromQuote(quoted, inspected, cached) {
  const id = quoted.stanzaId || cached?.id || null;
  if (!id && !quoted.message) return null;
  return {
    id: id || cached?.id || 'quoted-status',
    authorJid: quoted.participant || cached?.authorJid || null,
    key: cached?.key || {
      id: id || 'quoted-status',
      remoteJid: STATUS_BROADCAST_JID,
      participant: quoted.participant || undefined,
    },
    message: quoted.message || cached?.message,
    inspected,
    messageTimestamp: cached?.messageTimestamp,
  };
}

export function resolveRelevantStatus(ctx) {
  const quoted = ctx?.quoted;
  const cache = ctx?.statusCache;
  const hasQuote = Boolean(
    quoted && (quoted.message || quoted.stanzaId || quoted.remoteJid || quoted.participant),
  );

  if (hasQuote) {
    const cached = quoted.stanzaId && cache?.get ? cache.get(quoted.stanzaId) : null;
    if (!quotedPointsAtStatus(quoted, cached)) {
      throw new CommandError(ECHO_NOT_STATUS);
    }
    if (quoted.message) {
      const inspected = inspectStatusMessage(quoted.message);
      if (inspected.ok) return recordFromQuote(quoted, inspected, cached);
      if (!cached) throw new CommandError(inspected.reason || ECHO_UNSUPPORTED);
    }
    if (cached) return cached;
    throw new CommandError(ECHO_UNAVAILABLE);
  }

  const latest = cache?.latest?.() || null;
  if (!latest) throw new CommandError(ECHO_UNAVAILABLE);
  return latest;
}

export async function downloadStatusBuffer(record, { sock, logger } = {}) {
  const inspected = record?.inspected;
  const message = record?.message;
  const key = record?.key || {
    id: record?.id || 'status',
    remoteJid: STATUS_BROADCAST_JID,
    participant: record?.authorJid || undefined,
  };

  if (typeof sock?.downloadMediaMessage === 'function') {
    try {
      const buffer = await sock.downloadMediaMessage({ key, message }, 'buffer', {});
      if (isUsableBuffer(buffer)) return buffer;
    } catch (error) {
      logger?.warn?.(`Status socket download failed: ${error.message}`);
    }
  }

  try {
    const reupload =
      typeof sock?.updateMediaMessage === 'function'
        ? { logger: silentLogger(), reuploadRequest: (msg) => sock.updateMediaMessage(msg) }
        : undefined;
    const buffer = await downloadMediaMessage({ key, message }, 'buffer', {}, reupload);
    if (isUsableBuffer(buffer)) return buffer;
  } catch (error) {
    logger?.warn?.(`Status downloadMediaMessage failed: ${error.message}`);
  }

  try {
    const stream = await downloadContentFromMessage(inspected.media, inspected.downloadType);
    const buffer = await streamToBuffer(stream);
    if (isUsableBuffer(buffer)) return buffer;
  } catch (error) {
    logger?.warn?.(`Status downloadContentFromMessage failed: ${error.message}`);
  }

  throw new CommandError(ECHO_RETRIEVAL_FAILED);
}

export async function recoverViewedStatus(ctx) {
  const record = resolveRelevantStatus(ctx);
  const inspected = record.inspected;
  if (!inspected?.ok) throw new CommandError(inspected?.reason || ECHO_UNAVAILABLE);

  if (inspected.kind === 'text') {
    if (!inspected.text) throw new CommandError(ECHO_UNAVAILABLE);
    return {
      ...inspected,
      id: record.id,
      authorJid: record.authorJid,
      buffer: null,
    };
  }

  const download = typeof ctx.downloadStatus === 'function' ? ctx.downloadStatus : downloadStatusBuffer;
  if (download === downloadStatusBuffer && !hasDownloadableMedia(inspected.media)) {
    throw new CommandError(ECHO_MISSING_MEDIA);
  }

  let buffer;
  try {
    buffer = await download(record, {
      sock: ctx.sock,
      logger: ctx.logger,
    });
  } catch (error) {
    if (error instanceof CommandError) throw error;
    throw new CommandError(ECHO_RETRIEVAL_FAILED);
  }
  if (!isUsableBuffer(buffer)) throw new CommandError(ECHO_RETRIEVAL_FAILED);

  return {
    ...inspected,
    id: record.id,
    authorJid: record.authorJid,
    buffer,
  };
}

export function statusRevealCaption(recovered) {
  const lines = [`Viewed status (${recovered.kind})`];
  if (recovered.authorJid) lines.push(`Author: ${sanitizeField(recovered.authorJid, 80)}`);
  if (recovered.id) lines.push(`ID: ${sanitizeField(recovered.id, 80)}`);
  const body = recovered.kind === 'text' ? recovered.text : recovered.caption;
  if (body) lines.push(sanitizeField(body, 300));
  return lines.join('\n');
}

export function toStatusSendContent(recovered, { caption } = {}) {
  if (recovered.kind === 'text') {
    const text = caption === undefined ? recovered.text : caption;
    return { text };
  }

  const media = recovered.buffer;
  const mimetype = recovered.mimetype;
  const text = caption === undefined ? recovered.caption : caption;

  if (recovered.kind === 'image') {
    return {
      image: media,
      ...(mimetype ? { mimetype } : {}),
      ...(text ? { caption: text } : {}),
    };
  }
  if (recovered.kind === 'video') {
    return {
      video: media,
      ...(mimetype ? { mimetype } : {}),
      ...(text ? { caption: text } : {}),
    };
  }
  return {
    audio: media,
    ...(mimetype ? { mimetype } : {}),
    ptt: recovered.kind === 'voice' || recovered.ptt === true,
  };
}

export async function deliverEcho(ctx, mode, recovered) {
  if (mode === 'soul') {
    const ownerJid = resolveOwnerDestination(ctx);
    if (!ownerJid || !isUserJid(ownerJid)) {
      throw new CommandError('The Sovereign destination is not configured.');
    }
    const caption = statusRevealCaption(recovered);
    const content = toStatusSendContent(recovered, {
      caption: recovered.kind === 'audio' || recovered.kind === 'voice' ? undefined : caption,
    });
    await deliverToOwner(ctx, ownerJid, content);
    if (recovered.kind === 'audio' || recovered.kind === 'voice') {
      try {
        await ctx.sock.sendMessage(ownerJid, { text: caption });
      } catch (error) {
        ctx.logger?.warn?.(`Owner status context notice failed: ${error.message}`);
      }
    }
    return { destination: ownerJid, mode };
  }

  await deliverToChat(ctx, toStatusSendContent(recovered));
  return { destination: ctx.chatJid, mode };
}

export { resolveOwnerDestination, deliverToChat, deliverToOwner };
