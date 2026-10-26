import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractTargets,
  getContextInfo,
  getMessageText,
  isRecentMessage,
  parseCommand,
  resolveIncomingContent,
  resolvePrefix,
  resolveSenderJid,
  unwrapMessage,
} from '../handler/handler.js';
import { normalizeJid, toUserJid } from '../lib/helpers.js';

test('parseCommand accepts the configured prefix and splits arguments', () => {
  assert.deepEqual(parseCommand('!pulse', '!'), { name: 'pulse', args: [], argsText: '' });
  assert.deepEqual(parseCommand('!BEG shrine now', '!'), {
    name: 'beg',
    args: ['shrine', 'now'],
    argsText: 'shrine now',
  });
  assert.deepEqual(parseCommand('!oracle  what   now  ', '!'), {
    name: 'oracle',
    args: ['what', 'now'],
    argsText: 'what   now',
  });
});

test('parseCommand rejects missing prefix, empty commands and non-strings', () => {
  assert.equal(parseCommand('pulse', '!'), null);
  assert.equal(parseCommand(' !pulse', '!'), null);
  assert.equal(parseCommand('!', '!'), null);
  assert.equal(parseCommand('!   ', '!'), null);
  assert.equal(parseCommand(null, '!'), null);
  assert.equal(parseCommand('!pulse', ''), null);
});

test('parseCommand supports multi-character prefixes', () => {
  assert.deepEqual(parseCommand('..pulse', '..'), { name: 'pulse', args: [], argsText: '' });
});

test('unwrapMessage follows supported wrappers without unbounded recursion', () => {
  const inner = { conversation: 'bound text' };
  const wrapped = { ephemeralMessage: { message: { viewOnceMessage: { message: inner } } } };
  assert.deepEqual(unwrapMessage(wrapped), inner);
  let deep = { conversation: 'too deep' };
  for (let index = 0; index < 10; index += 1) deep = { ephemeralMessage: { message: deep } };
  assert.notDeepEqual(unwrapMessage(deep), { conversation: 'too deep' });
});

test('getMessageText reads conversation, text, caption and selected display text', () => {
  assert.equal(getMessageText({ conversation: 'plain' }), 'plain');
  assert.equal(getMessageText({ extendedTextMessage: { text: 'extended' } }), 'extended');
  assert.equal(getMessageText({ imageMessage: { caption: 'image caption' } }), 'image caption');
  assert.equal(getMessageText({ buttonsResponseMessage: { selectedDisplayText: 'choice' } }), 'choice');
  assert.equal(getMessageText(null), '');
});

test('getContextInfo reads quoted context from wrapped messages', () => {
  const contextInfo = { participant: '123@s.whatsapp.net', quotedMessage: { conversation: 'quote' } };
  const message = { ephemeralMessage: { message: { extendedTextMessage: { text: 'hi', contextInfo } } } };
  assert.equal(getContextInfo(message), contextInfo);
  assert.equal(getContextInfo({ conversation: 'no context' }), null);
});

test('extractTargets combines mentions, quoted participants and explicit JIDs', () => {
  const message = {
    extendedTextMessage: {
      text: 'attack @999@s.whatsapp.net',
      contextInfo: { participant: '456@s.whatsapp.net' },
    },
  };
  const targets = extractTargets({
    message,
    text: message.extendedTextMessage.text,
    mentions: ['123:7@s.whatsapp.net', '0@s.whatsapp.net', 'group@g.us'],
  });
  assert.deepEqual(targets, ['123@s.whatsapp.net', '456@s.whatsapp.net', '999@s.whatsapp.net']);
});

test('resolvePrefix prefers the group prefix, then the global setting, then config', () => {
  const db = { getSetting: (key, fallback) => (key === 'prefix' ? '#' : fallback) };
  const config = { prefix: '!' };
  assert.equal(resolvePrefix({ group: { prefix: '?' }, db, config }), '?');
  assert.equal(resolvePrefix({ group: null, db, config }), '#');
  assert.equal(resolvePrefix({ group: null, db: { getSetting: (_key, fallback) => fallback }, config }), '!');
});

test('resolveSenderJid reads participant, alternate and phone identity fields', () => {
  assert.equal(
    resolveSenderJid({ key: { participantAlt: '123:2@lid', remoteJid: '120@g.us' } }, { isGroup: true }),
    '123@lid',
  );
  assert.equal(
    resolveSenderJid({ key: { participantPn: '111@s.whatsapp.net', remoteJid: '120@g.us' } }, { isGroup: true }),
    '111@s.whatsapp.net',
  );
  assert.equal(
    resolveSenderJid({ key: { senderPn: '222@s.whatsapp.net', remoteJid: '120@g.us' } }, { isGroup: true }),
    '222@s.whatsapp.net',
  );
});

test('resolveIncomingContent reads protocol edits and recent append timestamps', () => {
  const edited = resolveIncomingContent({
    protocolMessage: {
      type: 'MESSAGE_EDIT',
      editedMessage: { conversation: 'https://edited.example' },
    },
  });
  assert.equal(getMessageText(edited), 'https://edited.example');
  assert.equal(isRecentMessage({ messageTimestamp: Math.floor(Date.now() / 1000) }), true);
  assert.equal(isRecentMessage({ messageTimestamp: 1_000 }), false);
});

test('JID helpers keep WhatsApp domains and strip device suffixes', () => {
  assert.equal(normalizeJid('123:4@s.whatsapp.net'), '123@s.whatsapp.net');
  assert.equal(normalizeJid('not-a-jid'), null);
  assert.equal(normalizeJid(''), null);
  assert.equal(toUserJid('+44 7700 900123'), '447700900123@s.whatsapp.net');
  assert.equal(toUserJid('abc'), null);
  assert.equal(toUserJid('123@g.us'), '123@g.us');
});
