import { chunk, normalizeJid } from './helpers.js';

export const MENTION_FALLBACK_BATCH = 250;
export const MIN_MENTION_BATCH = 8;

const PAYLOAD_LIMIT_RE =
  /payload|too large|too long|oversize|oversized|message size|size exceeded|too many mention|mention(?:s)?(?:\s+\w+){0,4}\s+limit|max(?:imum)? mentions|content.?length|length exceeded|resource-constraint|\b413\b/i;

export function isPayloadLimitError(error) {
  if (!error || typeof error !== 'object') return false;
  const status =
    error.statusCode ||
    error.status ||
    error.code ||
    error.output?.statusCode ||
    error.output?.payload?.statusCode;
  if (Number(status) === 413) return true;

  const parts = [
    error.message,
    error.name,
    error.code,
    error.statusCode,
    error.output?.payload?.message,
    error.output?.payload?.error,
    error.data?.message,
  ]
    .filter((value) => value !== undefined && value !== null)
    .map((value) => String(value));

  return PAYLOAD_LIMIT_RE.test(parts.join(' '));
}

export function resolveMaxMentions(config) {
  const value = Number(config?.security?.maxMentions);
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.floor(value);
}

export function listEligibleParticipants(groupMeta, botJid) {
  const bot = normalizeJid(botJid);
  const seen = new Set();
  const participants = [];
  for (const participant of groupMeta?.participants || []) {
    const jid = normalizeJid(participant.id);
    if (!jid || jid === bot || seen.has(jid)) continue;
    seen.add(jid);
    participants.push(jid);
  }
  return participants;
}

export function nextMentionBatchSize(count) {
  const size = Math.max(0, Number(count) || 0);
  if (size > MENTION_FALLBACK_BATCH) return MENTION_FALLBACK_BATCH;
  if (size <= MIN_MENTION_BATCH) return MIN_MENTION_BATCH;
  return Math.max(MIN_MENTION_BATCH, Math.ceil(size / 2));
}

async function deliverMentionMessage(ctx, text, mentions) {
  if (ctx.isAborted?.()) return null;

  const socket = ctx.sock;
  if (socket && typeof socket.sendMessage === 'function' && ctx.chatJid) {
    const sendOptions = ctx.message ? { quoted: ctx.message } : undefined;
    return socket.sendMessage(ctx.chatJid, { text, mentions }, sendOptions);
  }

  return ctx.reply(text, { mentions });
}

async function sendBatch(ctx, batch, formatBatch) {
  const formatted = formatBatch(batch) || {};
  const mentions = Array.isArray(formatted.mentions) ? formatted.mentions : batch;
  const result = await deliverMentionMessage(ctx, formatted.text, mentions);
  if (ctx.isAborted?.() && result === null) return { status: 'aborted' };
  if (result === null) return { status: 'unknown' };
  return { status: 'sent' };
}

async function sendAdaptive(ctx, batch, formatBatch) {
  try {
    const outcome = await sendBatch(ctx, batch, formatBatch);
    if (outcome.status === 'sent') {
      return { sent: batch.length, failed: 0, aborted: false };
    }
    if (outcome.status === 'aborted') {
      return { sent: 0, failed: batch.length, aborted: true };
    }
    return { sent: 0, failed: batch.length, aborted: false, ambiguous: true };
  } catch (error) {
    const payloadLimited = isPayloadLimitError(error);
    if (!payloadLimited || batch.length <= MIN_MENTION_BATCH) {
      return {
        sent: 0,
        failed: batch.length,
        aborted: false,
        error,
        payloadLimited,
      };
    }

    const size = nextMentionBatchSize(batch.length);
    if (size >= batch.length) {
      return { sent: 0, failed: batch.length, aborted: false, error, payloadLimited: true };
    }

    let sent = 0;
    let failed = 0;
    let lastError = error;
    let sawPayloadLimit = true;
    for (const part of chunk(batch, size)) {
      const nested = await sendAdaptive(ctx, part, formatBatch);
      sent += nested.sent;
      failed += nested.failed;
      if (nested.error) lastError = nested.error;
      if (nested.payloadLimited) sawPayloadLimit = true;
      if (nested.aborted) {
        const remaining = batch.length - sent - failed;
        return {
          sent,
          failed: failed + remaining,
          aborted: true,
          error: lastError,
          payloadLimited: sawPayloadLimit,
        };
      }
    }
    return {
      sent,
      failed,
      aborted: false,
      error: failed > 0 ? lastError : undefined,
      payloadLimited: sawPayloadLimit && failed > 0,
    };
  }
}

export async function broadcastMentions(ctx, { participants, formatBatch }) {
  const list = Array.isArray(participants) ? participants : [];
  if (!list.length) {
    return { sent: 0, failed: 0, aborted: false };
  }

  const result = await sendAdaptive(ctx, list, formatBatch);
  if (result.error && result.sent === 0 && !result.payloadLimited) {
    throw result.error;
  }
  return result;
}
