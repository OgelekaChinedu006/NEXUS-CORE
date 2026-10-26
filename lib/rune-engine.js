import { fullFrame } from './formatter.js';
import { displayMention, normalizeJid } from './helpers.js';
import { canonicalUserJid, identityJids, sameUser, sessionIdentityJids } from './identity.js';
import { isBotAdmin, isGroupAdmin, isGroupCreator, validateModerationTarget } from './permissions.js';
import { removeParticipant } from './moderation.js';
import {
  CRUSH_JOIN_WINDOW_MS,
  CRUSH_MASS_MENTION_COUNT,
  CRUSH_PREFIX_FLOOD_COUNT,
  CRUSH_PREFIX_WINDOW_MS,
  CRUSH_PREFIXES,
  GLOBAL_RUNE_SCOPE,
  GRACE_PUNISH_AT,
  INVITE_URL_PATTERN,
  LINK_URL_PATTERN,
  resolveRuneSetting,
} from './runes.js';

export {
  CRUSH_JOIN_WINDOW_MS,
  CRUSH_MASS_MENTION_COUNT,
  CRUSH_PREFIX_FLOOD_COUNT,
  CRUSH_PREFIX_WINDOW_MS,
  CRUSH_PREFIXES,
  GRACE_PUNISH_AT,
  INVITE_URL_PATTERN,
  LINK_URL_PATTERN,
};

export const RUNE_OFFENSES = Object.freeze({
  link: 'Smuggling an outside link into the domain',
  mention: 'Marking the Sovereign on a status',
  spam: 'Overwhelming cursed energy (message flood)',
  bot: 'Hostile vessel detected in the domain',
  call: 'Calling the Supreme Being without leave',
});

const GRACE_WARNING_LINES = Object.freeze({
  1: 'First mark. The Rune has seen you.',
  2: 'Second mark. The Rune grows impatient.',
  3: 'Third mark. One more violation and the configured punishment falls.',
});

function asList(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

export function isExemptFromRunes({
  senderJid,
  botJid,
  ownerJid,
  groupMeta,
  groupJid = null,
  db = null,
  isOwner = false,
  isSudo = false,
  isAdmin = false,
  isAlly = false,
} = {}) {
  const sender = normalizeJid(senderJid);
  if (!sender) return true;
  if (isOwner || isSudo || isAdmin || isAlly) return true;
  const ids = identityJids(groupMeta, sender);
  const owner = normalizeJid(ownerJid);
  const bot = normalizeJid(botJid);
  if (owner && (ids.includes(owner) || sameUser(groupMeta, sender, owner))) return true;
  if (bot && (ids.includes(bot) || sameUser(groupMeta, sender, bot))) return true;
  if (isGroupAdmin(groupMeta, sender) || isGroupCreator(groupMeta, sender)) return true;
  if (db) {
    if (ids.some((id) => db.isOperator?.(id))) return true;
    if (groupJid && ids.some((id) => db.isAlly?.(groupJid, id))) return true;
  }
  return false;
}

const USER_FACING_TEXT_KEYS = new Set([
  'conversation',
  'text',
  'caption',
  'selectedDisplayText',
  'selectedButtonId',
  'title',
  'description',
  'contentText',
  'footerText',
  'displayName',
  'name',
  'buttonText',
  'hydratedTitleText',
  'hydratedContentText',
  'hydratedFooterText',
  'matchedText',
]);

const SKIP_SCAN_KEYS = new Set([
  'quotedMessage',
  'quoted',
  'contextInfo',
  'messageContextInfo',
  'jpegThumbnail',
  'scansSidecar',
  'fileEncSha256',
  'fileSha256',
  'mediaKey',
  'mediaKeyTimestamp',
  'directPath',
  'thumbnailDirectPath',
  'url',
  'mediaUrl',
  'thumbnailUrl',
]);

function collectUserFacingText(node, acc = [], depth = 0) {
  if (!node || depth > 8) return acc;
  if (typeof node !== 'object') return acc;
  if (Array.isArray(node)) {
    for (const item of node) collectUserFacingText(item, acc, depth + 1);
    return acc;
  }
  for (const [key, value] of Object.entries(node)) {
    if (SKIP_SCAN_KEYS.has(key)) continue;
    if (typeof value === 'string') {
      if (USER_FACING_TEXT_KEYS.has(key)) acc.push(value);
      continue;
    }
    if (value && typeof value === 'object') collectUserFacingText(value, acc, depth + 1);
  }
  return acc;
}

function hasInvitePayload(node, depth = 0) {
  if (!node || typeof node !== 'object' || depth > 8) return false;
  if (Array.isArray(node)) {
    return node.some((item) => item && typeof item === 'object' && hasInvitePayload(item, depth + 1));
  }
  if (node.groupInviteMessage || node.groupInviteMessageV2) return true;
  if (node.inviteCode || node.inviteJid || node.inviteURL || node.inviteUrl) return true;
  for (const [key, value] of Object.entries(node)) {
    if (SKIP_SCAN_KEYS.has(key)) continue;
    if (value && typeof value === 'object' && hasInvitePayload(value, depth + 1)) return true;
  }
  return false;
}

const WHATSAPP_MEDIA_HOST_PATTERN = /(?:^|\/\/)(?:[a-z0-9-]+\.)*(?:cdn\.)?whatsapp\.net\b/i;

function collectLinkCandidates(text) {
  const value = String(text || '');
  if (!value) return [];
  return value.match(new RegExp(LINK_URL_PATTERN.source, 'gi')) || [];
}

function isWhatsAppMediaUrl(url) {
  return WHATSAPP_MEDIA_HOST_PATTERN.test(String(url || ''));
}

export function hasProhibitedLink(text = '') {
  return collectLinkCandidates(text).some((url) => !isWhatsAppMediaUrl(url));
}

export function detectInvite(message, text = '') {
  if (INVITE_URL_PATTERN.test(String(text || ''))) return true;
  if (hasInvitePayload(message)) return true;
  return collectUserFacingText(message).some((value) => INVITE_URL_PATTERN.test(value));
}

export function detectLink(text = '', message = null) {
  if (hasProhibitedLink(text)) return true;
  if (!message) return false;
  if (hasInvitePayload(message)) return true;
  return collectUserFacingText(message).some(
    (value) => hasProhibitedLink(value) || INVITE_URL_PATTERN.test(value),
  );
}

export function detectKnownBotPrefix(text = '') {
  const value = String(text || '');
  if (!value) return false;
  return CRUSH_PREFIXES.some((prefix) => value.startsWith(prefix));
}

export function countMentionedJids(mentions = []) {
  const unique = new Set();
  for (const mention of asList(mentions)) {
    const jid = normalizeJid(mention);
    if (jid) unique.add(jid);
  }
  return unique.size;
}

const STATUS_MENTION_WRAPPERS = [
  'statusMentionMessage',
  'groupStatusMentionMessage',
  'statusMentionedMessage',
];

export function isStatusMentionOfTarget(msg, { ownerJid, botJid, extraJids = [] } = {}) {
  const targets = [
    normalizeJid(ownerJid),
    normalizeJid(botJid),
    ...asList(extraJids).map(normalizeJid),
  ].filter(Boolean);
  if (!targets.length) return { ok: false, reason: 'no-target' };

  const key = msg?.key || {};
  const message = msg?.message;
  if (!message || typeof message !== 'object') return { ok: false, reason: 'no-payload' };

  const nested = unwrapForStatusMention(message);
  const info = nested.contextInfo;
  const protocolType = nested.protocolType;
  const hasWrapper = Boolean(nested.statusMentionMessage);
  const remoteJid = normalizeJid(info?.remoteJid);
  const keyRemote = normalizeJid(key.remoteJid);
  const participant = normalizeJid(info?.participant || key.participant);
  const mentioned = asList(info?.mentionedJid).map(normalizeJid).filter(Boolean);
  const statusJidList = asList(info?.statusJidList || info?.mentionedJidInStatus)
    .map(normalizeJid)
    .filter(Boolean);

  const protocolIsStatusMention =
    protocolType === 'STATUS_MENTION_MESSAGE' ||
    protocolType === 25 ||
    String(protocolType || '').toUpperCase() === 'STATUS_MENTION_MESSAGE';

  const quotedFromStatus = remoteJid === 'status@broadcast';
  const flag = Boolean(info?.statusMention || info?.isStatusMention);

  const isStatusSource = hasWrapper || protocolIsStatusMention || quotedFromStatus || flag;
  if (!isStatusSource) {
    return { ok: false, reason: 'not-status-mention' };
  }

  const pool = [...mentioned, ...statusJidList];
  if (quotedFromStatus || hasWrapper || protocolIsStatusMention || flag) {
    if (keyRemote && keyRemote !== 'status@broadcast') {
      pool.push(...mentioned);
    }
  }
  const hit = pool.find((jid) => targets.includes(jid));
  if (!hit) {
    return { ok: false, reason: 'target-not-mentioned' };
  }

  const eventId = info?.stanzaId || key.id || nested.protocolKey || null;
  if (!eventId) return { ok: false, reason: 'no-event-id' };

  return {
    ok: true,
    targetJid: hit,
    remoteJid: remoteJid || keyRemote,
    participant,
    eventId: String(eventId),
  };
}

function unwrapForStatusMention(message, depth = 0, acc = { contextInfo: null, statusMentionMessage: false }) {
  if (!message || typeof message !== 'object' || depth > 8) return acc;
  for (const wrapper of STATUS_MENTION_WRAPPERS) {
    if (message[wrapper]?.message) {
      return unwrapForStatusMention(message[wrapper].message, depth + 1, {
        ...acc,
        statusMentionMessage: true,
      });
    }
    if (message[wrapper]) {
      acc = { ...acc, statusMentionMessage: true };
    }
  }
  if (message.protocolMessage) {
    acc = {
      ...acc,
      protocolType: message.protocolMessage.type,
      protocolKey: message.protocolMessage.key?.id || null,
      contextInfo: message.protocolMessage.contextInfo || acc.contextInfo,
    };
  }
  for (const key of [
    'ephemeralMessage',
    'viewOnceMessage',
    'viewOnceMessageV2',
    'viewOnceMessageV2Extension',
    'documentWithCaptionMessage',
    'editedMessage',
    'deviceSentMessage',
    'futureProofMessage',
  ]) {
    if (message[key]?.message) {
      return unwrapForStatusMention(message[key].message, depth + 1, acc);
    }
  }
  for (const value of Object.values(message)) {
    if (value && typeof value === 'object' && value.contextInfo && !acc.contextInfo) {
      acc = { ...acc, contextInfo: value.contextInfo };
    }
  }
  if (message.contextInfo && !acc.contextInfo) acc = { ...acc, contextInfo: message.contextInfo };
  return acc;
}

export function classifyCall(callEvent) {
  const raw = Array.isArray(callEvent) ? callEvent[0] : callEvent;
  if (!raw || typeof raw !== 'object') return { ok: false, reason: 'empty' };
  const id = raw.id || raw.callId || null;
  const from = normalizeJid(raw.from || raw.chatId || raw.peerJid);
  const callerPn = normalizeJid(raw.callerPn || raw.caller_pn);
  const status = String(raw.status || '').toLowerCase();
  const isGroup = Boolean(raw.isGroup || raw.groupJid || (from && from.endsWith('@g.us')));
  if (!id) return { ok: false, reason: 'no-id' };
  if (!from) return { ok: false, reason: 'no-from' };
  if (isGroup || (from && from.endsWith('@g.us'))) return { ok: false, reason: 'group-call' };
  if (status !== 'offer') return { ok: false, reason: 'not-offer' };
  return { ok: true, id: String(id), from, callerPn, status };
}

export function crushSignals({ text = '', mentions = [], message = null, prefixTimestamps = [] } = {}) {
  const prefixFlood = prefixTimestamps.length >= CRUSH_PREFIX_FLOOD_COUNT;
  const massMention = countMentionedJids(mentions) >= CRUSH_MASS_MENTION_COUNT;
  const invite = detectInvite(message, text);
  return {
    prefixFlood,
    massMention,
    invite,
    matched: [prefixFlood, massMention, invite].filter(Boolean).length,
  };
}

export function canCrushRemove({
  joinedAt,
  now = Date.now(),
  signals,
} = {}) {
  if (!joinedAt || now - joinedAt > CRUSH_JOIN_WINDOW_MS) return false;
  return Number(signals?.matched) >= 2;
}

function warningText(rune, mode, count, extra = []) {
  const title = `${String(rune).toUpperCase()} RUNE`;
  const lines = [
    `🩸 MODE: ${String(mode).toUpperCase()}`,
    `⛓ OFFENSE: ${RUNE_OFFENSES[rune] || rune}`,
    ...extra,
  ];
  if (mode === 'grace') {
    lines.push(`👁 MARKS: ${count}/${GRACE_PUNISH_AT - 1}`);
    lines.push(GRACE_WARNING_LINES[count] || 'The Rune has marked this soul.');
  } else if (mode === 'mercy') {
    lines.push('👁 MARK: a single warning. No further punishment in Mercy.');
  }
  return fullFrame(`🧿 ${title}`, lines);
}

function failureText(rune, failures) {
  return fullFrame(`⚠️ ${String(rune).toUpperCase()} RUNE FAILED`, [
    'The Rune acted, but not every operation succeeded.',
    ...failures.map((entry) => `▸ ${entry}`),
  ]);
}

function punishmentText(rune, punishment, extra = []) {
  return fullFrame(`☠️ ${String(rune).toUpperCase()} RUNE`, [
    `⛓ OFFENSE: ${RUNE_OFFENSES[rune] || rune}`,
    `🩸 VERDICT: ${String(punishment).toUpperCase()}`,
    ...extra,
  ]);
}

async function deleteMessage(sock, chatJid, msg, logger) {
  if (!msg?.key) return { ok: false, reason: 'no-key' };
  try {
    await sock.sendMessage(chatJid, { delete: msg.key });
    return { ok: true };
  } catch (error) {
    logger?.warn?.(`Rune deletion failed: ${error.message}`);
    return { ok: false, reason: error.message };
  }
}

async function sendNotice(sock, chatJid, content, mentions, logger) {
  try {
    await sock.sendMessage(chatJid, { text: content, ...(mentions?.length ? { mentions } : {}) });
    return { ok: true };
  } catch (error) {
    logger?.warn?.(`Rune notice failed: ${error.message}`);
    return { ok: false, reason: error.message };
  }
}

async function applyKick({ sock, groupJid, targetJid, groupMeta, botJid, db, actorJid, reason, logger }) {
  if (!isBotAdmin(groupMeta, botJid)) {
    return { ok: false, reason: 'The vessel lacks admin power to banish this soul.' };
  }
  try {
    await removeParticipant({ sock, groupJid, targetJid });
    db?.logModeration?.(groupJid, 'rune-kick', targetJid, actorJid || botJid, reason);
    return { ok: true };
  } catch (error) {
    logger?.warn?.(`Rune kick failed: ${error.message}`);
    return { ok: false, reason: error.message };
  }
}

async function applyConfiguredPunishment({
  punishment = 'kick',
  sock,
  groupJid,
  targetJid,
  groupMeta,
  botJid,
  db,
  actorJid,
  reason,
  logger,
}) {
  const kind = String(punishment || '').trim().toLowerCase();
  if (kind === 'kick') {
    return applyKick({ sock, groupJid, targetJid, groupMeta, botJid, db, actorJid, reason, logger });
  }
  return { ok: false, reason: `Unsupported punishment "${kind}".` };
}

function runeIdentity(groupMeta, userJid) {
  const target = normalizeJid(userJid);
  const ids = identityJids(groupMeta, target);
  return {
    userJid: target,
    canonicalJid: canonicalUserJid(groupMeta, target) || target,
    ids: ids.length ? ids : (target ? [target] : []),
  };
}

function adoptIdentityViolations(db, scope, userJid, rune, groupMeta) {
  const identity = runeIdentity(groupMeta, userJid);
  const target = identity.userJid;
  if (!target || !db?.runes) return identity;
  let extra = 0;
  for (const id of identity.ids) {
    if (id === target) continue;
    extra += db.runes.getViolationCount(scope, id, rune);
    db.runes.resetViolation(scope, id, rune);
  }
  for (let index = 0; index < extra; index += 1) {
    db.runes.incrementViolation(scope, target, rune);
  }
  return identity;
}

export async function enforceRuneViolation({
  db,
  sock,
  logger,
  rune,
  scope,
  chatJid,
  userJid,
  mode,
  punishment = 'kick',
  msg = null,
  groupMeta = null,
  botJid = null,
  deleteOffending = true,
  notify = true,
  extraLines = [],
} = {}) {
  const identity = adoptIdentityViolations(db, scope, userJid, rune, groupMeta);
  const targetJid = identity.userJid || userJid;
  const failures = [];
  let deleted = false;
  let warned = false;
  let punished = false;
  let count = db.runes.getViolationCount(scope, targetJid, rune);

  if (deleteOffending && msg) {
    const deletion = await deleteMessage(sock, chatJid, msg, logger);
    deleted = deletion.ok;
    if (!deletion.ok) failures.push(`Delete failed: ${deletion.reason}`);
  }

  const noticeExtra = [
    ...extraLines,
    ...failures.map((entry) => `⚠️ ${entry}`),
  ];

  if (mode === 'mercy') {
    const alreadyWarned = identity.ids.some((id) => db.runes.hasEvent(`mercy:${scope}:${id}`, rune));
    if (alreadyWarned) {
      return { deleted, warned: false, punished: false, count, failures, reset: false, alreadyWarned: true };
    }
    if (notify) {
      const notice = warningText(rune, mode, 1, noticeExtra);
      const sent = await sendNotice(sock, chatJid, notice, [targetJid], logger);
      warned = sent.ok;
      if (sent.ok) db.runes.claimEvent(`mercy:${scope}:${targetJid}`, rune);
      else failures.push(`Warning failed: ${sent.reason}`);
    }
    return { deleted, warned, punished: false, count, failures, reset: false };
  }

  const punishmentArgs = {
    punishment,
    sock,
    groupJid: chatJid,
    targetJid,
    groupMeta,
    botJid,
    db,
    actorJid: botJid,
    logger,
  };

  if (mode === 'exile') {
    const result = await applyConfiguredPunishment({
      ...punishmentArgs,
      reason: RUNE_OFFENSES[rune],
    });
    punished = result.ok;
    if (!result.ok) failures.push(`Punishment failed: ${result.reason}`);
    if (notify) {
      const text = punished
        ? punishmentText(rune, punishment, noticeExtra)
        : failureText(rune, failures);
      const sent = await sendNotice(sock, chatJid, text, [targetJid], logger);
      if (!sent.ok) failures.push(`Notice failed: ${sent.reason}`);
    }
    return { deleted, warned: false, punished, count, failures, reset: punished };
  }

  const next = db.runes.incrementViolation(scope, targetJid, rune);
  count = next.count;

  if (count < GRACE_PUNISH_AT) {
    const notice = warningText(rune, 'grace', count, noticeExtra);
    if (notify) {
      const sent = await sendNotice(sock, chatJid, notice, [targetJid], logger);
      warned = sent.ok;
      if (!sent.ok) failures.push(`Warning failed: ${sent.reason}`);
    }
    return { deleted, warned, punished: false, count, failures, reset: false };
  }

  const result = await applyConfiguredPunishment({
    ...punishmentArgs,
    reason: `${RUNE_OFFENSES[rune]} (Grace ${count})`,
  });
  punished = result.ok;
  if (!result.ok) {
    failures.push(`Punishment failed: ${result.reason}`);
  } else {
    for (const id of identity.ids) {
      db.runes.resetViolation(scope, id, rune);
    }
  }
  if (notify) {
    const text = punished
      ? punishmentText(rune, punishment, noticeExtra)
      : failureText(rune, failures);
    const sent = await sendNotice(sock, chatJid, text, [targetJid], logger);
    if (!sent.ok) failures.push(`Notice failed: ${sent.reason}`);
  }
  return { deleted, warned: false, punished, count, failures, reset: punished };
}

function asJidList(value) {
  if (value == null) return [];
  const unique = [];
  for (const entry of Array.isArray(value) ? value : [value]) {
    const jid = normalizeJid(entry);
    if (jid && !unique.includes(jid)) unique.push(jid);
  }
  return unique;
}

export function createJoinTracker({ ttlMs = CRUSH_JOIN_WINDOW_MS } = {}) {
  const joins = new Map();

  function key(groupJid, userJid) {
    return `${groupJid}:${userJid}`;
  }

  return {
    record(groupJid, userJid, at = Date.now()) {
      const group = normalizeJid(groupJid);
      if (!group) return;
      for (const user of asJidList(userJid)) {
        joins.set(key(group, user), at);
      }
    },
    get(groupJid, userJid) {
      const group = normalizeJid(groupJid);
      if (!group) return null;
      for (const user of asJidList(userJid)) {
        const stamp = joins.get(key(group, user));
        if (stamp) return stamp;
      }
      return null;
    },
    prune(now = Date.now()) {
      for (const [entry, stamp] of joins) {
        if (now - stamp > ttlMs) joins.delete(entry);
      }
    },
  };
}

export function createPrefixFloodTracker({ windowMs = CRUSH_PREFIX_WINDOW_MS } = {}) {
  const buckets = new Map();

  function key(groupJid, userJid) {
    return `${groupJid}:${userJid}`;
  }

  function stampsFor(group, user, at) {
    const id = key(group, user);
    const stamps = (buckets.get(id) || []).filter((stamp) => at - stamp < windowMs);
    if (stamps.length) buckets.set(id, stamps);
    else buckets.delete(id);
    return stamps;
  }

  return {
    record(groupJid, userJid, at = Date.now()) {
      const group = normalizeJid(groupJid);
      if (!group) return [];
      const users = asJidList(userJid);
      let stamps = [];
      for (const user of users) {
        const current = stampsFor(group, user, at);
        if (current.length > stamps.length) stamps = current;
      }
      stamps = [...stamps, at];
      for (const user of users) {
        buckets.set(key(group, user), stamps);
      }
      return stamps;
    },
    get(groupJid, userJid, at = Date.now()) {
      const group = normalizeJid(groupJid);
      if (!group) return [];
      let best = [];
      for (const user of asJidList(userJid)) {
        const stamps = stampsFor(group, user, at);
        if (stamps.length > best.length) best = stamps;
      }
      return best;
    },
    prune(now = Date.now()) {
      for (const [id, stamps] of buckets) {
        const fresh = stamps.filter((stamp) => now - stamp < windowMs);
        if (fresh.length) buckets.set(id, fresh);
        else buckets.delete(id);
      }
    },
  };
}

export async function applyBotLockdown({ sock, groupJid, db, actorJid, logger }) {
  const failures = [];
  try {
    await sock.groupSettingUpdate(groupJid, 'announcement');
  } catch (error) {
    logger?.warn?.(`Bot Rune lockdown announcement failed: ${error.message}`);
    failures.push(`Announcement mode failed: ${error.message}`);
  }
  try {
    await sock.groupMemberAddMode(groupJid, 'admin_add');
    db?.updateGroup?.(groupJid, { member_add_mode: 'admin_add' });
  } catch (error) {
    logger?.warn?.(`Bot Rune lockdown admission failed: ${error.message}`);
    failures.push(`Admission restriction failed: ${error.message}`);
  }
  db?.logModeration?.(groupJid, 'bot-rune-lockdown', null, actorJid, 'Bot Rune lockdown');
  return { ok: failures.length === 0, failures, removed: false };
}

export async function applyBotCrushZone({
  sock,
  db,
  logger,
  groupJid,
  groupMeta,
  botJid,
  ownerJid,
  targetJid,
  actorJid,
  msg,
  joinedAt,
  signals,
  now = Date.now(),
  removalGuard,
} = {}) {
  const failures = [];

  if (msg?.key) {
    const deletion = await deleteMessage(sock, groupJid, msg, logger);
    if (!deletion.ok) failures.push(`Delete failed: ${deletion.reason}`);
  }

  if (!canCrushRemove({ joinedAt, now, signals })) {
    return { ok: failures.length === 0, failures, removed: false, reason: 'criteria-unmet' };
  }

  const target = normalizeJid(targetJid);
  const targetIds = identityJids(groupMeta, target);
  if (
    targetIds.some((id) => db?.isOperator?.(id)) ||
    targetIds.some((id) => db?.isAlly?.(groupJid, id)) ||
    isGroupAdmin(groupMeta, target) ||
    isGroupCreator(groupMeta, target)
  ) {
    return { ok: failures.length === 0, failures, removed: false, reason: 'protected-target' };
  }

  const validation = validateModerationTarget({
    actorJid: actorJid || botJid,
    targetJid: target,
    botJid,
    ownerJid,
    groupMeta,
    actorIsOwner: false,
  });
  if (!validation.ok) {
    return { ok: false, failures: [...failures, validation.reason], removed: false, reason: 'invalid-target' };
  }

  if (!isBotAdmin(groupMeta, botJid)) {
    return {
      ok: false,
      failures: [...failures, 'The vessel lacks admin power to remove the attacker.'],
      removed: false,
      reason: 'not-bot-admin',
    };
  }

  const guardKey = `${groupJid}:${validation.target}`;
  if (removalGuard?.has(guardKey)) {
    return { ok: true, failures, removed: false, reason: 'duplicate-removal' };
  }

  try {
    await removeParticipant({ sock, groupJid, targetJid: validation.target });
    removalGuard?.add(guardKey);
    db?.logModeration?.(groupJid, 'bot-rune-crush', validation.target, botJid, 'Crush Zone removal');
    return { ok: failures.length === 0, failures, removed: true };
  } catch (error) {
    logger?.warn?.(`Bot Rune crush removal failed: ${error.message}`);
    return { ok: false, failures: [...failures, error.message], removed: false, reason: 'remove-failed' };
  }
}

export async function resolveCallIdentities({ sock, callerJid, extraJids = [], ownerJid, botJid, db } = {}) {
  const caller = normalizeJid(callerJid);
  const ids = [];
  const add = (value) => {
    const normalized = normalizeJid(value);
    if (normalized && !ids.includes(normalized)) ids.push(normalized);
  };
  add(caller);
  for (const extra of extraJids) add(extra);

  const mapping = { phoneJid: null, lidJid: null, mapped: false, source: null };
  const isLid = Boolean(caller && caller.endsWith('@lid'));
  const isPhone = Boolean(caller && caller.endsWith('@s.whatsapp.net'));
  for (const id of ids) {
    if (id.endsWith('@s.whatsapp.net') && !mapping.phoneJid) mapping.phoneJid = id;
    if (id.endsWith('@lid') && !mapping.lidJid) mapping.lidJid = id;
  }
  if (mapping.phoneJid && mapping.lidJid) {
    mapping.mapped = true;
    mapping.source = 'event';
  }

  const tryMap = async (fn, source) => {
    if (typeof fn !== 'function' || mapping.mapped) return;
    try {
      const result = await fn(caller);
      const resolved = Array.isArray(result) ? result[0] : result;
      const jid = normalizeJid(resolved?.jid || resolved?.pn || resolved?.phoneNumber || resolved);
      if (jid) {
        add(jid);
        if (jid.endsWith('@s.whatsapp.net')) mapping.phoneJid = jid;
        if (jid.endsWith('@lid')) mapping.lidJid = jid;
        mapping.mapped = true;
        mapping.source = source;
      }
    } catch {
      // Mapping is best-effort; absence is reported honestly later.
    }
  };

  const lidMapping = sock?.signalRepository?.lidMapping;
  if (lidMapping && typeof lidMapping.getPNForLID === 'function' && isLid) {
    await tryMap((lid) => lidMapping.getPNForLID(lid), 'lidMapping');
  }
  if (lidMapping && typeof lidMapping.getLIDForPN === 'function' && isPhone) {
    await tryMap((pn) => lidMapping.getLIDForPN(pn), 'lidMapping');
  }

  const protectedIds = [
    normalizeJid(ownerJid),
    normalizeJid(botJid),
    ...sessionIdentityJids(sock?.user),
  ].filter(Boolean);

  return {
    caller,
    ids,
    mapping,
    privileged: ids.some((id) => {
      if (protectedIds.includes(id)) return true;
      return Boolean(db?.isOperator?.(id));
    }),
  };
}

export async function handleCallRune({
  db,
  sock,
  logger,
  ownerJid,
  botJid,
  callEvent,
} = {}) {
  const classified = classifyCall(callEvent);
  if (!classified.ok) return { skipped: true, reason: classified.reason };

  const setting = resolveRuneSetting(db, GLOBAL_RUNE_SCOPE, 'call');
  if (!setting.enabled) return { skipped: true, reason: 'disabled' };

  const identity = await resolveCallIdentities({
    sock,
    callerJid: classified.from,
    extraJids: classified.callerPn ? [classified.callerPn] : [],
    ownerJid,
    botJid,
    db,
  });
  const caller = identity.mapping.phoneJid || identity.caller;
  if (identity.privileged) {
    return { skipped: true, reason: 'privileged-caller' };
  }

  if (!db.runes.claimEvent(classified.id, 'call')) {
    return { skipped: true, reason: 'duplicate' };
  }

  const failures = [];
  let rejected = false;
  let blocked = false;
  let warned = false;

  if (typeof sock.rejectCall !== 'function') {
    failures.push('rejectCall is not available on this socket.');
  } else {
    try {
      await sock.rejectCall(classified.id, classified.from);
      rejected = true;
    } catch (error) {
      logger?.warn?.(`Call Rune reject failed: ${error.message}`);
      failures.push(`Reject failed: ${error.message}`);
    }
  }

  const dm = (text) => sendNotice(sock, classified.from, text, null, logger);
  const mercyText = fullFrame('🧿 CALL RUNE', [
    'The Supreme Being is unavailable.',
    'Do not call again.',
  ]);

  if (setting.mode === 'mercy') {
    const alreadyWarned = identity.ids.some((id) => (
      db.runes.hasEvent(`mercy:${GLOBAL_RUNE_SCOPE}:${id}`, 'call')
    ));
    if (!alreadyWarned) {
      const sent = await dm(mercyText);
      warned = sent.ok;
      if (sent.ok) db.runes.claimEvent(`mercy:${GLOBAL_RUNE_SCOPE}:${caller}`, 'call');
      else failures.push(`Warning DM failed: ${sent.reason}`);
    }
    return { skipped: false, rejected, blocked: false, warned, failures, count: 0, mode: 'mercy' };
  }

  for (const id of identity.ids) {
    if (id === caller) continue;
    const extra = db.runes.getViolationCount(GLOBAL_RUNE_SCOPE, id, 'call');
    if (!extra) continue;
    for (let index = 0; index < extra; index += 1) {
      db.runes.incrementViolation(GLOBAL_RUNE_SCOPE, caller, 'call');
    }
    db.runes.resetViolation(GLOBAL_RUNE_SCOPE, id, 'call');
  }
  const next = db.runes.incrementViolation(GLOBAL_RUNE_SCOPE, caller, 'call');
  const count = next.count;
  const shouldBlock = setting.mode === 'exile' || count >= GRACE_PUNISH_AT;

  if (!shouldBlock) {
    const sent = await dm(warningText('call', 'grace', count, [
      'The Supreme Being is unavailable.',
      'Private calls are forbidden.',
    ]));
    warned = sent.ok;
    if (!sent.ok) failures.push(`Warning DM failed: ${sent.reason}`);
    return { skipped: false, rejected, blocked: false, warned, failures, count, mode: 'grace' };
  }

  const blockJid = identity.mapping.phoneJid || (caller.endsWith('@s.whatsapp.net') ? caller : null);
  if (!blockJid) {
    failures.push('LID-to-phone mapping is unavailable; a phone-number block was not applied.');
  } else if (typeof sock.updateBlockStatus !== 'function') {
    failures.push('updateBlockStatus is not available on this socket.');
  } else {
    try {
      await sock.updateBlockStatus(blockJid, 'block');
      blocked = true;
      for (const id of identity.ids) {
        db.runes.resetViolation(GLOBAL_RUNE_SCOPE, id, 'call');
      }
    } catch (error) {
      logger?.warn?.(`Call Rune block failed: ${error.message}`);
      failures.push(`Block failed: ${error.message}`);
    }
  }

  const blockNotice = setting.mode === 'exile'
    ? 'The first call is the last. This number is now blocked.'
    : 'The fourth call is the last. This number is now blocked.';
  const sent = await dm(
    blocked
      ? fullFrame('☠️ CALL RUNE', [blockNotice])
      : failureText('call', failures),
  );
  if (!sent.ok) failures.push(`Notice DM failed: ${sent.reason}`);
  return { skipped: false, rejected, blocked, warned: false, failures, count, mode: setting.mode };
}

export function groupRuneSetting(db, groupJid, rune) {
  return resolveRuneSetting(db, groupJid, rune);
}

export { displayMention, GLOBAL_RUNE_SCOPE };
