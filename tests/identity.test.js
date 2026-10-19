import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalUserJid, participantAliases, sameUser } from '../lib/identity.js';

const groupMeta = {
  participants: [
    {
      id: '111111111111111@lid',
      phoneNumber: '2348012345678@s.whatsapp.net',
      admin: 'admin',
    },
    {
      id: '2349011112222@s.whatsapp.net',
      lid: '222222222222222@lid',
    },
    { id: '2347000000000@s.whatsapp.net' },
  ],
};

test('participantAliases collects normalized JIDs from every known field', () => {
  assert.deepEqual(
    participantAliases({
      id: '1:5@lid',
      lid: '1@lid',
      jid: '234801@s.whatsapp.net',
      phoneNumber: '234801:7@s.whatsapp.net',
      lidJid: '9@lid',
    }),
    ['1@lid', '234801@s.whatsapp.net', '9@lid'],
  );
});

test('participantAliases tolerates missing, empty and malformed fields', () => {
  assert.deepEqual(participantAliases(undefined), []);
  assert.deepEqual(participantAliases(null), []);
  assert.deepEqual(participantAliases({}), []);
  assert.deepEqual(participantAliases({ id: '', lid: null, phoneNumber: 12345 }), []);
  assert.deepEqual(participantAliases({ id: 'no-at-sign', jid: '@s.whatsapp.net' }), []);
  assert.deepEqual(participantAliases({ id: 'a@s.whatsapp.net' }), ['a@s.whatsapp.net']);
});

test('a bare-digit phoneNumber becomes a phone JID, without guessing anything', () => {
  assert.deepEqual(
    participantAliases({ id: '5@lid', phoneNumber: '2348012345678' }),
    ['5@lid', '2348012345678@s.whatsapp.net'],
  );
  const bare = { participants: [{ id: '5@lid', phoneNumber: '2348012345678' }] };
  assert.equal(canonicalUserJid(bare, '2348012345678@s.whatsapp.net'), '5@lid');
  assert.equal(sameUser(bare, '5@lid', '2348012345678:3@s.whatsapp.net'), true);
  // exact matching is unchanged: no country-code or trailing-digit matching
  assert.equal(canonicalUserJid(bare, '8012345678@s.whatsapp.net'), '8012345678@s.whatsapp.net');
  assert.equal(sameUser(bare, '5@lid', '8012345678@s.whatsapp.net'), false);
});

test('bare digits are converted only for phoneNumber and only when strictly digits', () => {
  assert.deepEqual(participantAliases({ phoneNumber: '12345' }), []);
  assert.deepEqual(participantAliases({ phoneNumber: '+2348012345678' }), []);
  assert.deepEqual(participantAliases({ phoneNumber: '234 801 234 5678' }), []);
  assert.deepEqual(participantAliases({ phoneNumber: '2348012345678:7' }), []);
  assert.deepEqual(participantAliases({ phoneNumber: 2348012345678 }), []);
  assert.deepEqual(participantAliases({ id: '2348012345678' }), []);
  assert.deepEqual(participantAliases({ lid: '111111111111111', jid: '2348012345678' }), []);
});

test('canonicalUserJid maps a phone JID to the participant LID id', () => {
  assert.equal(
    canonicalUserJid(groupMeta, '2348012345678@s.whatsapp.net'),
    '111111111111111@lid',
  );
});

test('canonicalUserJid maps a LID to the participant phone id', () => {
  assert.equal(
    canonicalUserJid(groupMeta, '222222222222222@lid'),
    '2349011112222@s.whatsapp.net',
  );
});

test('canonicalUserJid ignores device suffixes on input and participant ids', () => {
  assert.equal(
    canonicalUserJid(groupMeta, '2348012345678:12@s.whatsapp.net'),
    '111111111111111@lid',
  );
  const suffixed = { participants: [{ id: '2347001:3@s.whatsapp.net' }] };
  assert.equal(canonicalUserJid(suffixed, '2347001@s.whatsapp.net'), '2347001@s.whatsapp.net');
});

test('canonicalUserJid without group metadata only normalizes', () => {
  assert.equal(canonicalUserJid(null, '2348012345678:4@s.whatsapp.net'), '2348012345678@s.whatsapp.net');
  assert.equal(canonicalUserJid(undefined, 'x@lid'), 'x@lid');
  assert.equal(canonicalUserJid({}, 'x@lid'), 'x@lid');
  assert.equal(canonicalUserJid(null, 'garbage'), null);
  assert.equal(canonicalUserJid(null, null), null);
});

test('canonicalUserJid returns the normalized input when nothing matches', () => {
  assert.equal(
    canonicalUserJid(groupMeta, '2340000000000:2@s.whatsapp.net'),
    '2340000000000@s.whatsapp.net',
  );
});

test('matching is exact: similar trailing digits do not match', () => {
  assert.equal(canonicalUserJid(groupMeta, '8012345678@s.whatsapp.net'), '8012345678@s.whatsapp.net');
  assert.equal(canonicalUserJid(groupMeta, '2348012345679@s.whatsapp.net'), '2348012345679@s.whatsapp.net');
  assert.equal(sameUser(groupMeta, '8012345678@s.whatsapp.net', '2348012345678@s.whatsapp.net'), false);
});

test('sameUser treats LID and phone forms of one participant as equal', () => {
  assert.equal(sameUser(groupMeta, '111111111111111@lid', '2348012345678@s.whatsapp.net'), true);
  assert.equal(sameUser(groupMeta, '2348012345678:9@s.whatsapp.net', '111111111111111:1@lid'), true);
  assert.equal(sameUser(groupMeta, '222222222222222@lid', '2349011112222@s.whatsapp.net'), true);
});

test('sameUser distinguishes different participants and handles bad input', () => {
  assert.equal(sameUser(groupMeta, '111111111111111@lid', '2347000000000@s.whatsapp.net'), false);
  assert.equal(sameUser(groupMeta, null, null), false);
  assert.equal(sameUser(groupMeta, 'garbage', 'garbage'), false);
  assert.equal(sameUser(null, 'a@s.whatsapp.net', 'a:2@s.whatsapp.net'), true);
  assert.equal(sameUser(null, 'a@s.whatsapp.net', 'b@s.whatsapp.net'), false);
});
