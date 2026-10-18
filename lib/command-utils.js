import { CommandError, normalizeJid, sanitizeField, truncate } from './helpers.js';
import { validateModerationTarget } from './permissions.js';

export function cleanReason(text, fallback = 'The King found your conduct wanting.') {
  const cleaned = String(text || '')
    .replace(/@\d{5,20}/g, ' ')
    .replace(/\b\d{5,20}@[a-z.]+\b/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return truncate(sanitizeField(cleaned, 300), 300) || fallback;
}

export function moderationTarget(ctx) {
  if (!ctx.isGroup) throw new CommandError('This curse only works inside a group.');
  if (!ctx.targetJid) {
    throw new CommandError('Mention the target, reply to their message, or pass their WhatsApp JID.');
  }
  const validation = validateModerationTarget({
    actorJid: ctx.senderJid,
    targetJid: ctx.targetJid,
    botJid: ctx.botJid,
    ownerJid: ctx.config.ownerJid,
    groupMeta: ctx.groupMeta,
    actorIsOwner: ctx.isOwner,
  });
  if (!validation.ok) throw new CommandError(validation.reason);
  return validation.target;
}

export function findParticipant(groupMeta, jid) {
  const target = normalizeJid(jid);
  if (!groupMeta || !target) return null;
  return groupMeta.participants?.find((participant) => normalizeJid(participant.id) === target) || null;
}

export function isParticipantAdmin(groupMeta, jid) {
  return Boolean(findParticipant(groupMeta, jid)?.admin);
}

export function apiFailure(action, error) {
  return new CommandError(
    `WhatsApp refused the ${action} operation. ${truncate(error?.message || 'Unknown failure.', 120)}`,
  );
}
