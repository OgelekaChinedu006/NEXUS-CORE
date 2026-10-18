import { normalizeJid } from './helpers.js';

export const PERMISSION_LEVELS = Object.freeze({
  public: 0,
  group: 1,
  admin: 2,
  botAdmin: 3,
  sudo: 4,
  owner: 5,
});

export const PERMISSION_LABELS = Object.freeze({
  public: 'everyone',
  group: 'group members',
  admin: 'group admins',
  botAdmin: 'the vessel must be a group admin',
  sudo: 'NEXUS operators',
  owner: 'the Sovereign owner',
});

export function isGroupAdmin(groupMeta, jid) {
  const target = normalizeJid(jid);
  if (!groupMeta || !target) return false;
  const participant = groupMeta.participants?.find(
    (entry) => normalizeJid(entry.id) === target,
  );
  return Boolean(participant?.admin);
}

export function isGroupCreator(groupMeta, jid) {
  const target = normalizeJid(jid);
  if (!groupMeta || !target) return false;
  const creator = normalizeJid(groupMeta.owner);
  if (creator) return creator === target;
  return Boolean(
    groupMeta.participants?.find(
      (entry) => normalizeJid(entry.id) === target && entry.admin === 'superadmin',
    ),
  );
}

export function isBotAdmin(groupMeta, botJid) {
  return isGroupAdmin(groupMeta, botJid);
}

export function describePermissions(required = ['public']) {
  const list = Array.isArray(required) && required.length ? required : ['public'];
  return list.map((permission) => PERMISSION_LABELS[permission] || permission).join(' + ');
}

export function checkPermissions({
  required = ['public'],
  isGroup = false,
  groupMeta = null,
  senderJid,
  botJid,
  isOwner = false,
  isSudo = false,
}) {
  const requirements = Array.isArray(required) && required.length ? required : ['public'];
  const missing = [];

  for (const requirement of requirements) {
    switch (requirement) {
      case 'public':
        break;
      case 'group':
        if (!isGroup) missing.push('This curse only works inside a group.');
        break;
      case 'admin':
        if (!isGroup) {
          missing.push('This curse only works inside a group.');
        } else if (!isOwner && !isSudo && !isGroupAdmin(groupMeta, senderJid)) {
          missing.push('Only group admins may invoke this curse.');
        }
        break;
      case 'botAdmin':
        if (!isGroup) {
          missing.push('This curse only works inside a group.');
        } else if (!isBotAdmin(groupMeta, botJid)) {
          missing.push('The bot must be a group admin to perform this action.');
        }
        break;
      case 'sudo':
        if (!isOwner && !isSudo) missing.push('Only NEXUS operators may invoke this curse.');
        break;
      case 'owner':
        if (!isOwner) missing.push('Only the Sovereign owner may invoke this curse.');
        break;
      default:
        missing.push(`Unknown permission requirement: ${requirement}`);
    }
  }

  return {
    allowed: missing.length === 0,
    missing,
    reason: missing[0] || '',
  };
}

export function validateModerationTarget({
  actorJid,
  targetJid,
  botJid,
  ownerJid,
  groupMeta,
  actorIsOwner = false,
}) {
  const actor = normalizeJid(actorJid);
  const target = normalizeJid(targetJid);
  const bot = normalizeJid(botJid);
  const owner = normalizeJid(ownerJid);

  if (!target) return { ok: false, reason: 'That soul cannot be identified. Mention or reply to a real member.' };
  if (target === actor) return { ok: false, reason: 'You cannot turn the curse on yourself.' };
  if (target === bot) return { ok: false, reason: 'The vessel cannot be shattered by its own curse.' };
  if (target === owner) return { ok: false, reason: 'The Sovereign cannot be targeted.' };
  if (isGroupCreator(groupMeta, target) && !actorIsOwner) {
    return { ok: false, reason: 'The domain founder cannot be targeted by a lesser authority.' };
  }
  return { ok: true, target };
}
