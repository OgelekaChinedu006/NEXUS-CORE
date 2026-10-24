import { downloadContentFromMessage, downloadMediaMessage, getContentType } from '@whiskeysockets/baileys';
import { CommandError, isUserJid, normalizeJid, sanitizeField } from './helpers.js';

export const VV_SUCCESS_MESSAGE = 'Nothing stays hidden before the King.';

const VIEW_ONCE_WRAPPERS = new Set([
  'viewOnceMessage',
  'viewOnceMessageV2',
  'viewOnceMessageV2Extension',
]);

const OTHER_WRAPPERS = [
  'ephemeralMessage',
  'documentWithCaptionMessage',
  'editedMessage',
  'deviceSentMessage',
];

const SUPPORTED = Object.freeze({
  imageMessage: { kind: 'image', downloadType: 'image' },
  videoMessage: { kind: 'video', downloadType: 'video' },
  audioMessage: { kind: 'audio', downloadType: 'audio' },
});

const MISSING_QUOTE = 'Reply directly to a view-once message.';
const UNSUPPORTED = 'That message is not a view-once image, video, audio or voice note.';
const RETRIEVAL_FAILED = 'The view-once media could not be retrieved. It may be inaccessible or expired.';
const DELIVERY_FAILED = 'The recovered media could not be delivered.';
const OWNER_MISSING = 'The Sovereign destination is not configured.';

function isViewOnceFlag(value) {
  return value === true || value === 1 || value === '1';
}

function unwrapQuoted(message) {
  let current = message;
  let viewOnce = false;
  for (let depth = 0; depth <= 6; depth += 1) {
    if (!current || typeof current !== 'object') break;
    const viewOnceKey = [...VIEW_ONCE_WRAPPERS].find((key) => current[key]?.message);
    if (viewOnceKey) {
      viewOnce = true;
      current = current[viewOnceKey].message;
      continue;
    }
    const otherKey = OTHER_WRAPPERS.find((key) => current[key]?.message);
    if (otherKey) {
      current = current[otherKey].message;
      continue;
    }
    break;
  }
  return { content: current, viewOnce };
}

export function inspectViewOnceMessage(message) {
  if (!message || typeof message !== 'object') {
    return { ok: false, reason: MISSING_QUOTE };
  }

  const { content, viewOnce: wrappedViewOnce } = unwrapQuoted(message);
  const type = getContentType(content || {});
  const spec = type ? SUPPORTED[type] : null;
  const media = spec ? content[type] : null;

  if (!spec || !media || typeof media !== 'object') {
    return { ok: false, reason: UNSUPPORTED };
  }

  if (!wrappedViewOnce && !isViewOnceFlag(media.viewOnce)) {
    return { ok: false, reason: UNSUPPORTED };
  }

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

export function requireQuotedViewOnce(ctx) {
  const quotedMessage = ctx?.quoted?.message;
  if (!quotedMessage) throw new CommandError(MISSING_QUOTE);
  const inspected = inspectViewOnceMessage(quotedMessage);
  if (!inspected.ok) throw new CommandError(inspected.reason);
  return { quotedMessage, inspected };
}

export function resolveOwnerDestination(ctx) {
  const ownerJid = normalizeJid(ctx?.config?.ownerJid);
  if (!ownerJid || !isUserJid(ownerJid)) {
    throw new CommandError(OWNER_MISSING);
  }
  return ownerJid;
}

async function streamToBuffer(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks);
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

export async function downloadViewOnceBuffer(inspected, { sock, quotedMessage, logger } = {}) {
  if (typeof sock?.downloadMediaMessage === 'function') {
    try {
      const buffer = await sock.downloadMediaMessage(
        { key: { id: 'vv' }, message: quotedMessage },
        'buffer',
        {},
      );
      if (isUsableBuffer(buffer)) return buffer;
    } catch (error) {
      logger?.warn?.(`View-once socket download failed: ${error.message}`);
    }
  }

  try {
    const reupload =
      typeof sock?.updateMediaMessage === 'function'
        ? { logger: silentLogger(), reuploadRequest: (msg) => sock.updateMediaMessage(msg) }
        : undefined;
    const buffer = await downloadMediaMessage(
      { key: { id: 'vv' }, message: quotedMessage },
      'buffer',
      {},
      reupload,
    );
    if (isUsableBuffer(buffer)) return buffer;
  } catch (error) {
    logger?.warn?.(`View-once downloadMediaMessage failed: ${error.message}`);
  }

  try {
    const stream = await downloadContentFromMessage(inspected.media, inspected.downloadType);
    const buffer = await streamToBuffer(stream);
    if (isUsableBuffer(buffer)) return buffer;
  } catch (error) {
    logger?.warn?.(`View-once downloadContentFromMessage failed: ${error.message}`);
  }

  throw new CommandError(RETRIEVAL_FAILED);
}

export async function recoverQuotedViewOnce(ctx) {
  const { quotedMessage, inspected } = requireQuotedViewOnce(ctx);
  const download = typeof ctx.downloadViewOnce === 'function' ? ctx.downloadViewOnce : downloadViewOnceBuffer;
  let buffer;
  try {
    buffer = await download(inspected, {
      sock: ctx.sock,
      quotedMessage,
      logger: ctx.logger,
    });
  } catch (error) {
    if (error instanceof CommandError) throw error;
    throw new CommandError(RETRIEVAL_FAILED);
  }
  if (!isUsableBuffer(buffer)) throw new CommandError(RETRIEVAL_FAILED);
  return { ...inspected, buffer };
}

export function toSendContent(recovered, { caption } = {}) {
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

export function ownerRevealCaption(ctx, recovered) {
  const lines = [`Recovered view-once ${recovered.kind}`];
  if (ctx?.chatJid) lines.push(`Origin: ${sanitizeField(ctx.chatJid, 80)}`);
  if (ctx?.isGroup && ctx.groupMeta?.subject) {
    lines.push(`Group: ${sanitizeField(ctx.groupMeta.subject, 80)}`);
  }
  if (ctx?.quoted?.participant) {
    lines.push(`Sender: ${sanitizeField(ctx.quoted.participant, 80)}`);
  }
  if (recovered.caption) lines.push(sanitizeField(recovered.caption, 300));
  return lines.join('\n');
}

export async function deliverToChat(ctx, content) {
  if (typeof ctx.replyContent !== 'function') {
    throw new CommandError(DELIVERY_FAILED);
  }
  try {
    const result = await ctx.replyContent(content);
    if (result == null) throw new CommandError(DELIVERY_FAILED);
    return result;
  } catch (error) {
    if (error instanceof CommandError) throw error;
    throw new CommandError(DELIVERY_FAILED);
  }
}

export async function deliverToOwner(ctx, ownerJid, content) {
  const sock = ctx.sock;
  if (!sock || typeof sock.sendMessage !== 'function') {
    throw new CommandError(DELIVERY_FAILED);
  }
  try {
    const result = await sock.sendMessage(ownerJid, content);
    if (result == null) throw new CommandError(DELIVERY_FAILED);
    return result;
  } catch (error) {
    if (error instanceof CommandError) throw error;
    throw new CommandError(DELIVERY_FAILED);
  }
}

export { DELIVERY_FAILED, MISSING_QUOTE, OWNER_MISSING, RETRIEVAL_FAILED, UNSUPPORTED };
