import test from 'node:test';
import assert from 'node:assert/strict';
import {
  checkPermissions,
  describePermissions,
  isBotAdmin,
  isGroupAdmin,
  isGroupCreator,
  validateModerationTarget,
} from '../lib/permissions.js';

const groupMeta = {
  owner: 'creator@s.whatsapp.net',
  participants: [
    { id: 'creator@s.whatsapp.net', admin: 'superadmin' },
    { id: 'admin@s.whatsapp.net', admin: 'admin' },
    { id: 'member@s.whatsapp.net' },
    { id: 'bot:3@s.whatsapp.net', admin: 'admin' },
  ],
};

test('group admin and creator checks use participant metadata', () => {
  assert.equal(isGroupAdmin(groupMeta, 'admin@s.whatsapp.net'), true);
  assert.equal(isGroupAdmin(groupMeta, 'bot@s.whatsapp.net'), true);
  assert.equal(isGroupAdmin(groupMeta, 'member@s.whatsapp.net'), false);
  assert.equal(isGroupAdmin(null, 'admin@s.whatsapp.net'), false);
  assert.equal(isGroupCreator(groupMeta, 'creator@s.whatsapp.net'), true);
  assert.equal(isGroupCreator(groupMeta, 'admin@s.whatsapp.net'), false);
  assert.equal(isBotAdmin(groupMeta, 'bot@s.whatsapp.net'), true);
  assert.equal(isBotAdmin(groupMeta, 'member@s.whatsapp.net'), false);
});

test('public commands are allowed everywhere and group commands need a group', () => {
  assert.equal(checkPermissions({ required: ['public'], isGroup: false }).allowed, true);
  assert.equal(checkPermissions({ required: ['group'], isGroup: false }).allowed, false);
  assert.equal(checkPermissions({ required: ['group'], isGroup: true }).allowed, true);
});

test('admin requirements allow owners and sudo operators but not ordinary members', () => {
  const base = {
    required: ['admin'],
    isGroup: true,
    groupMeta,
    senderJid: 'member@s.whatsapp.net',
    botJid: 'bot@s.whatsapp.net',
  };
  assert.equal(checkPermissions(base).allowed, false);
  assert.equal(checkPermissions({ ...base, senderJid: 'admin@s.whatsapp.net' }).allowed, true);
  assert.equal(checkPermissions({ ...base, isSudo: true }).allowed, true);
  assert.equal(checkPermissions({ ...base, isOwner: true }).allowed, true);
  assert.match(checkPermissions(base).reason, /group admins/i);
});

test('botAdmin requires the bot to hold admin authority even for the owner', () => {
  const meta = {
    participants: [
      { id: 'owner@s.whatsapp.net', admin: 'superadmin' },
      { id: 'bot@s.whatsapp.net' },
    ],
  };
  const result = checkPermissions({
    required: ['admin', 'botAdmin'],
    isGroup: true,
    groupMeta: meta,
    senderJid: 'owner@s.whatsapp.net',
    botJid: 'bot@s.whatsapp.net',
    isOwner: true,
  });
  assert.equal(result.allowed, false);
  assert.match(result.reason, /bot must be a group admin/i);
});

test('owner and sudo checks are distinct', () => {
  assert.equal(checkPermissions({ required: ['owner'], isOwner: true }).allowed, true);
  assert.equal(checkPermissions({ required: ['owner'], isSudo: true }).allowed, false);
  assert.equal(checkPermissions({ required: ['sudo'], isSudo: true }).allowed, true);
  assert.equal(checkPermissions({ required: ['sudo'], isOwner: true }).allowed, true);
});

test('unknown permissions fail closed', () => {
  const result = checkPermissions({ required: ['root'] });
  assert.equal(result.allowed, false);
  assert.match(result.reason, /Unknown permission/i);
});

test('permission descriptions stay readable', () => {
  assert.equal(describePermissions(['admin', 'botAdmin']), 'group admins + the vessel must be a group admin');
  assert.equal(describePermissions([]), 'everyone');
  assert.equal(describePermissions(['sudo']), 'NEXUS operators');
});

test('moderation targets reject self, bot, owner and the domain founder', () => {
  const base = {
    actorJid: 'admin@s.whatsapp.net',
    botJid: 'bot@s.whatsapp.net',
    ownerJid: 'owner@s.whatsapp.net',
    groupMeta,
  };
  assert.equal(validateModerationTarget({ ...base, targetJid: 'admin@s.whatsapp.net' }).ok, false);
  assert.equal(validateModerationTarget({ ...base, targetJid: 'bot@s.whatsapp.net' }).ok, false);
  assert.equal(validateModerationTarget({ ...base, targetJid: 'owner@s.whatsapp.net' }).ok, false);
  assert.equal(validateModerationTarget({ ...base, targetJid: 'creator@s.whatsapp.net' }).ok, false);
  assert.equal(
    validateModerationTarget({
      ...base,
      targetJid: 'creator@s.whatsapp.net',
      actorIsOwner: true,
    }).ok,
    true,
  );
  assert.equal(validateModerationTarget({ ...base, targetJid: 'member@s.whatsapp.net' }).ok, true);
  assert.equal(validateModerationTarget({ ...base, targetJid: null }).ok, false);
});
