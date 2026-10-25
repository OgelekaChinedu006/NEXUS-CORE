import { fullFrame } from './formatter.js';
import { displayMention, normalizeJid } from './helpers.js';
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
  isOwner = false,
  isSudo = false,
  isAdmin = false,
  isAlly = false,
} = {}) {
  const sender = normalizeJid(senderJid);
  if (!sender) return true;
  if (isOwner || isSudo || isAdmin || isAlly) return true;
  if (ownerJid && sender === normalizeJid(ownerJid)) return true;
  if (botJid && sender === normalizeJid(botJid)) return true;
  if (isGroupAdmin(groupMeta, sender) || isGroupCreator(groupMeta, sender)) return true;
  return false;
}

export function detectInvite(message, text = '') {
  if (INVITE_URL_PATTERN.test(String(text || ''))) return true;
  const unwrapped = message && typeof message === 'object' ? message : null;
  if (!unwrapped) return false;
  if (unwrapped.groupInviteMessage) return true;
  for (const key of Object.keys(unwrapped)) {
    if (unwrapped[key]?.groupInviteMessage) return true;
  }
  return false;
}

export function detectLink(text = '') {
  return LINK_URL_PATTERN.test(String(text || ''));
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

export function isStatusMentionOfTarget(msg, { ownerJid, botJid } = {}) {
  const targets = [normalizeJid(ownerJid), normalizeJid(botJid)].filter(Boolean);
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
  const status = String(raw.status || '').toLowerCase();
  const isGroup = Boolean(raw.isGroup || raw.groupJid || (from && from.endsWith('@g.us')));
  if (!id) return { ok: false, reason: 'no-id' };
  if (!from) return { ok: false, reason: 'no-from' };
  if (isGroup || (from && from.endsWith('@g.us'))) return { ok: false, reason: 'group-call' };
  if (status !== 'offer') return { ok: false, reason: 'not-offer' };
  return { ok: true, id: String(id), from, status };
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
  const failures = [];
  let deleted = false;
  let warned = false;
  let punished = false;
  let count = db.runes.getViolationCount(scope, userJid, rune);

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
    const notice = warningText(rune, mode, 1, noticeExtra);
    if (notify) {
      const sent = await sendNotice(sock, chatJid, notice, [userJid], logger);
      warned = sent.ok;
      if (!sent.ok) failures.push(`Warning failed: ${sent.reason}`);
    }
    return { deleted, warned, punished, count, failures, reset: false };
  }

  if (mode === 'exile') {
    const result = await applyKick({
      sock,
      groupJid: chatJid,
      targetJid: userJid,
      groupMeta,
      botJid,
      db,
      actorJid: botJid,
      reason: RUNE_OFFENSES[rune],
      logger,
    });
    punished = result.ok;
    if (!result.ok) failures.push(`Punishment failed: ${result.reason}`);
    if (notify) {
      const text = punished
        ? punishmentText(rune, punishment, noticeExtra)
        : failureText(rune, failures);
      const sent = await sendNotice(sock, chatJid, text, [userJid], logger);
      if (!sent.ok) failures.push(`Notice failed: ${sent.reason}`);
    }
    return { deleted, warned: false, punished, count, failures, reset: punished };
  }

  const next = db.runes.incrementViolation(scope, userJid, rune);
  count = next.count;

  if (count < GRACE_PUNISH_AT) {
    const notice = warningText(rune, 'grace', count, noticeExtra);
    if (notify) {
      const sent = await sendNotice(sock, chatJid, notice, [userJid], logger);
      warned = sent.ok;
      if (!sent.ok) failures.push(`Warning failed: ${sent.reason}`);
    }
    return { deleted, warned, punished: false, count, failures, reset: false };
  }

  const result = await applyKick({
    sock,
    groupJid: chatJid,
    targetJid: userJid,
    groupMeta,
    botJid,
    db,
    actorJid: botJid,
    reason: `${RUNE_OFFENSES[rune]} (Grace ${count})`,
    logger,
  });
  punished = result.ok;
  if (!result.ok) {
    failures.push(`Punishment failed: ${result.reason}`);
  } else {
    db.runes.resetViolation(scope, userJid, rune);
  }
  if (notify) {
    const text = punished
      ? punishmentText(rune, punishment, noticeExtra)
      : failureText(rune, failures);
    const sent = await sendNotice(sock, chatJid, text, [userJid], logger);
    if (!sent.ok) failures.push(`Notice failed: ${sent.reason}`);
  }
  return { deleted, warned: false, punished, count, failures, reset: punished };
}

export function createJoinTracker({ ttlMs = CRUSH_JOIN_WINDOW_MS } = {}) {
  const joins = new Map();

  function key(groupJid, userJid) {
    return `${groupJid}:${userJid}`;
  }

  return {
    record(groupJid, userJid, at = Date.now()) {
      const group = normalizeJid(groupJid);
      const user = normalizeJid(userJid);
      if (!group || !user) return;
      joins.set(key(group, user), at);
    },
    get(groupJid, userJid) {
      return joins.get(key(normalizeJid(groupJid), normalizeJid(userJid))) || null;
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

  return {
    record(groupJid, userJid, at = Date.now()) {
      const id = key(normalizeJid(groupJid), normalizeJid(userJid));
      const stamps = (buckets.get(id) || []).filter((stamp) => at - stamp < windowMs);
      stamps.push(at);
      buckets.set(id, stamps);
      return stamps;
    },
    get(groupJid, userJid, at = Date.now()) {
      const id = key(normalizeJid(groupJid), normalizeJid(userJid));
      const stamps = (buckets.get(id) || []).filter((stamp) => at - stamp < windowMs);
      if (stamps.length) buckets.set(id, stamps);
      else buckets.delete(id);
      return stamps;
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
  const restrictions = await applyBotLockdown({ sock, groupJid, db, actorJid: actorJid || botJid, logger });
  failures.push(...restrictions.failures);

  if (msg?.key) {
    const deletion = await deleteMessage(sock, groupJid, msg, logger);
    if (!deletion.ok) failures.push(`Delete failed: ${deletion.reason}`);
  }

  if (!canCrushRemove({ joinedAt, now, signals })) {
    return { ok: failures.length === 0, failures, removed: false, reason: 'criteria-unmet' };
  }

  const target = normalizeJid(targetJid);
  if (db?.isOperator?.(target) || db?.isAlly?.(groupJid, target) || isGroupAdmin(groupMeta, target)) {
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

  const caller = classified.from;
  if (caller === normalizeJid(ownerJid) || db.isOperator?.(caller)) {
    return { skipped: true, reason: 'privileged-caller' };
  }
  if (caller === normalizeJid(botJid)) return { skipped: true, reason: 'self' };

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
    const sent = await dm(mercyText);
    warned = sent.ok;
    if (!sent.ok) failures.push(`Warning DM failed: ${sent.reason}`);
    return { skipped: false, rejected, blocked: false, warned, failures, count: 0, mode: 'mercy' };
  }

  const next = db.runes.incrementViolation(GLOBAL_RUNE_SCOPE, caller, 'call');
  const count = next.count;

  if (count < GRACE_PUNISH_AT) {
    const sent = await dm(warningText('call', 'grace', count, [
      'The Supreme Being is unavailable.',
      'Private calls are forbidden.',
    ]));
    warned = sent.ok;
    if (!sent.ok) failures.push(`Warning DM failed: ${sent.reason}`);
    return { skipped: false, rejected, blocked: false, warned, failures, count, mode: 'grace' };
  }

  if (typeof sock.updateBlockStatus !== 'function') {
    failures.push('updateBlockStatus is not available on this socket.');
  } else {
    try {
      await sock.updateBlockStatus(classified.from, 'block');
      blocked = true;
      db.runes.resetViolation(GLOBAL_RUNE_SCOPE, caller, 'call');
    } catch (error) {
      logger?.warn?.(`Call Rune block failed: ${error.message}`);
      failures.push(`Block failed: ${error.message}`);
    }
  }

  const sent = await dm(
    blocked
      ? fullFrame('☠️ CALL RUNE', ['The fourth call is the last. This number is now blocked.'])
      : failureText('call', failures),
  );
  if (!sent.ok) failures.push(`Notice DM failed: ${sent.reason}`);
  return { skipped: false, rejected, blocked, warned: false, failures, count, mode: 'grace' };
}

export function groupRuneSetting(db, groupJid, rune) {
  return resolveRuneSetting(db, groupJid, rune);
}

export { displayMention, GLOBAL_RUNE_SCOPE };
