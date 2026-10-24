import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createConfig } from '../config/config.js';
import { loadCommands } from '../lib/registry.js';
import { createLogger } from '../lib/logger.js';
import {
  MENTION_FALLBACK_BATCH,
  MIN_MENTION_BATCH,
  broadcastMentions,
  isPayloadLimitError,
  listEligibleParticipants,
  nextMentionBatchSize,
  resolveMaxMentions,
} from '../lib/mention-broadcast.js';

const ROOT = path.resolve(import.meta.dirname, '..');
const logger = createLogger({ level: 'silent' });

let registryPromise;
function registry() {
  registryPromise ??= loadCommands(path.join(ROOT, 'commands'), logger);
  return registryPromise;
}

function baseConfig(overrides = {}) {
  return {
    prefix: '!',
    ownerJid: 'owner@s.whatsapp.net',
    ownerDisplay: 'The Sovereign',
    botName: 'TEST CORE',
    version: '1.0.0',
    baileysVersion: '7.0.0-rc14',
    locale: 'en-GB',
    timezone: 'UTC',
    shrine: { slogan: 'The King does not ask.' },
    security: { maxMentions: 500 },
    ...overrides,
  };
}

function payloadError(message = 'message too large: payload limit exceeded') {
  const error = new Error(message);
  error.statusCode = 413;
  return error;
}

function participants(count, { includeBot = true } = {}) {
  const list = Array.from({ length: count }, (_, index) => ({
    id: `user${index}@s.whatsapp.net`,
  }));
  if (includeBot) list.push({ id: 'bot@s.whatsapp.net', admin: 'admin' });
  return list;
}

function context({
  commandOverrides = {},
  replyImpl,
  sendImpl,
  groupSize = 3,
  groupMeta,
  argsText = '',
  isAdmin = true,
  senderJid = 'admin@s.whatsapp.net',
  config,
} = {}) {
  const replies = [];
  const sends = [];
  const ctx = {
    prefix: '!',
    args: [],
    argsText,
    senderJid,
    botJid: 'bot@s.whatsapp.net',
    isGroup: true,
    isOwner: false,
    isSudo: false,
    isAdmin,
    isBotAdmin: true,
    chatJid: '120363000000000000@g.us',
    config: config || baseConfig(),
    groupMeta: groupMeta || {
      participants: participants(groupSize),
    },
    logger,
    reply: async (text, options = {}) => {
      if (replyImpl) return replyImpl(text, options, replies);
      replies.push({ text, options });
      return { ok: true };
    },
    ...commandOverrides,
  };

  if (sendImpl) {
    ctx.sock = {
      sendMessage: async (jid, content, options) => {
        sends.push({ jid, content, options });
        return sendImpl(jid, content, options, sends);
      },
    };
  }

  return { ctx, replies, sends };
}

test('MAX_MENTIONS defaults to 500 and clamps to the configured ceiling', () => {
  assert.equal(createConfig({}).security.maxMentions, 500);
  assert.equal(createConfig({ MAX_MENTIONS: '500' }).security.maxMentions, 500);
  assert.equal(createConfig({ MAX_MENTIONS: '120' }).security.maxMentions, 120);
  assert.equal(createConfig({ MAX_MENTIONS: '600' }).security.maxMentions, 500);
  assert.equal(createConfig({ MAX_MENTIONS: '5' }).security.maxMentions, 10);
  assert.equal(resolveMaxMentions({ security: { maxMentions: 500 } }), 500);
});

test('payload-limit detection ignores unrelated transport errors', () => {
  assert.equal(isPayloadLimitError(payloadError()), true);
  assert.equal(isPayloadLimitError(new Error('too many mentions in this message')), true);
  assert.equal(isPayloadLimitError(new Error('message size exceeded')), true);
  assert.equal(isPayloadLimitError(new Error('ECONNRESET')), false);
  assert.equal(isPayloadLimitError(new Error('not-authorized')), false);
  assert.equal(nextMentionBatchSize(500), MENTION_FALLBACK_BATCH);
  assert.equal(nextMentionBatchSize(250), 125);
  assert.equal(nextMentionBatchSize(MIN_MENTION_BATCH), MIN_MENTION_BATCH);
});

test('eligible participant lists exclude the bot and duplicate JIDs', () => {
  const listed = listEligibleParticipants(
    {
      participants: [
        { id: 'user0@s.whatsapp.net' },
        { id: 'user0:3@s.whatsapp.net' },
        { id: 'bot@s.whatsapp.net', admin: 'admin' },
        { id: 'user1@s.whatsapp.net' },
      ],
    },
    'bot@s.whatsapp.net',
  );
  assert.deepEqual(listed, ['user0@s.whatsapp.net', 'user1@s.whatsapp.net']);
});

test('summon and converge send one message for 500 eligible participants', async () => {
  const loaded = await registry();
  const groupMeta = { participants: participants(500) };

  for (const name of ['summon', 'converge']) {
    const { ctx, replies } = context({ groupMeta, argsText: 'Appear', groupSize: 500 });
    await loaded.get(name).execute(ctx);
    assert.equal(replies.length, 1, name);
    assert.equal(replies[0].options.mentions.length, 500, name);
    assert.equal(replies[0].options.mentions.includes('bot@s.whatsapp.net'), false, name);
    assert.match(replies[0].text, /@user0/);
    assert.match(replies[0].text, /@user499/);
    assert.match(replies[0].text, /WORD: Appear/);
    assert.doesNotMatch(replies[0].text, /@bot\b/);
  }
});

test('summon and converge fall back to 250-participant batches after a payload-limit failure', async () => {
  const loaded = await registry();
  const groupMeta = { participants: participants(500) };

  for (const name of ['summon', 'converge']) {
    const { ctx, replies, sends } = context({
      groupMeta,
      argsText: 'Split now',
      sendImpl: (_jid, content) => {
        if (content.mentions.length > 250) throw payloadError();
        return { ok: true };
      },
    });
    await loaded.get(name).execute(ctx);
    assert.equal(sends.length, 3, name);
    assert.equal(sends[0].content.mentions.length, 500, name);
    assert.equal(sends[1].content.mentions.length, 250, name);
    assert.equal(sends[2].content.mentions.length, 250, name);
    assert.deepEqual(sends[1].content.mentions, sends[0].content.mentions.slice(0, 250));
    assert.deepEqual(sends[2].content.mentions, sends[0].content.mentions.slice(250));
    assert.match(sends[1].content.text, /WORD: Split now/);
    assert.match(sends[2].content.text, /WORD: Split now/);
    assert.equal(replies.length, 0, name);
  }
});

test('mention fallback reduces further when a 250-participant batch also fails', async () => {
  const loaded = await registry();
  const groupMeta = { participants: participants(500) };
  const { ctx, sends } = context({
    groupMeta,
    sendImpl: (_jid, content) => {
      if (content.mentions.length > 125) throw payloadError();
      return { ok: true };
    },
  });
  await loaded.get('summon').execute(ctx);
  assert.equal(sends.length, 7);
  assert.equal(sends[0].content.mentions.length, 500);
  assert.equal(sends[1].content.mentions.length, 250);
  const successful = sends.filter((entry) => entry.content.mentions.length <= 125);
  assert.equal(successful.length, 4);
  assert.ok(successful.every((entry) => entry.content.mentions.length === 125));
  const named = successful.flatMap((entry) => entry.content.mentions);
  assert.equal(named.length, 500);
  assert.equal(new Set(named).size, 500);
});

test('unrelated send errors do not trigger mention fallback', async () => {
  const loaded = await registry();
  const groupMeta = { participants: participants(40) };
  const { ctx, sends } = context({
    groupMeta,
    sendImpl: () => {
      throw new Error('ECONNRESET');
    },
  });
  await assert.rejects(() => loaded.get('converge').execute(ctx), /ECONNRESET/);
  assert.equal(sends.length, 1);
  assert.equal(sends[0].content.mentions.length, 40);
});

test('ambiguous null send results are not retried', async () => {
  const loaded = await registry();
  const groupMeta = { participants: participants(40) };
  const { ctx, replies, sends } = context({
    groupMeta,
    sendImpl: () => null,
  });
  await loaded.get('summon').execute(ctx);
  assert.equal(sends.length, 1);
  assert.equal(replies.length, 1);
  assert.match(replies[0].text, /INCOMPLETE SUMMONING/);
  assert.match(replies[0].text, /NAMED: 0/);
  assert.match(replies[0].text, /UNREACHED: 40/);
});

test('partial batch failure reports only the souls that were named', async () => {
  const loaded = await registry();
  const groupMeta = { participants: participants(16) };
  let attempts = 0;
  const { ctx, replies, sends } = context({
    groupMeta,
    sendImpl: (_jid, content) => {
      attempts += 1;
      if (content.mentions.length > MIN_MENTION_BATCH) throw payloadError();
      if (content.mentions[0] === 'user8@s.whatsapp.net') throw payloadError();
      return { ok: true };
    },
  });
  await loaded.get('summon').execute(ctx);
  assert.equal(sends.length, 3);
  assert.equal(sends[1].content.mentions.length, 8);
  assert.equal(sends[2].content.mentions.length, 8);
  assert.equal(replies.length, 1);
  assert.match(replies[0].text, /INCOMPLETE SUMMONING/);
  assert.match(replies[0].text, /NAMED: 8/);
  assert.match(replies[0].text, /UNREACHED: 8/);
  assert.equal(attempts, 3);
});

test('empty participant lists do not send mention messages', async () => {
  const loaded = await registry();
  const empty = context({
    groupMeta: { participants: [{ id: 'bot@s.whatsapp.net', admin: 'admin' }] },
  });
  await loaded.get('summon').execute(empty.ctx);
  assert.equal(empty.replies.length, 1);
  assert.match(empty.replies[0].text, /EMPTY DOMAIN/);
  assert.equal(empty.replies[0].options.mentions, undefined);

  const convergeEmpty = context({
    groupMeta: { participants: [{ id: 'bot@s.whatsapp.net', admin: 'admin' }] },
  });
  await loaded.get('converge').execute(convergeEmpty.ctx);
  assert.match(convergeEmpty.replies[0].text, /EMPTY DOMAIN/);
});

test('groups above the 500-participant threshold are refused without mentions', async () => {
  const loaded = await registry();
  const groupMeta = { participants: participants(501) };
  for (const name of ['summon', 'converge']) {
    const { ctx, replies } = context({ groupMeta });
    await loaded.get(name).execute(ctx);
    assert.equal(replies.length, 1, name);
    assert.match(replies[0].text, /DOMAIN TOO VAST/);
    assert.match(replies[0].text, /SOULS: 501/);
    assert.match(replies[0].text, /SAFE LIMIT: 500/);
    assert.equal(replies[0].options.mentions, undefined, name);
  }
});

test('converge stays open to ordinary members while summon remains admin-gated', async () => {
  const loaded = await registry();
  const summon = loaded.get('summon');
  const converge = loaded.get('converge');
  assert.deepEqual(summon.permissions, ['admin']);
  assert.deepEqual(converge.permissions, ['group']);
  assert.equal(summon.cooldownMs, 10000);
  assert.equal(converge.cooldownMs, 10000);
  assert.equal(summon.category, 'domain');
  assert.equal(converge.category, 'domain');
  assert.deepEqual(summon.aliases, ['tagall']);
  assert.deepEqual(converge.aliases, []);

  const { ctx, replies } = context({
    isAdmin: false,
    senderJid: 'user0@s.whatsapp.net',
    argsText: 'Ordinary gathering',
  });
  await converge.execute(ctx);
  assert.equal(replies.length, 1);
  assert.match(replies[0].text, /CONVERGE/);
  assert.match(replies[0].text, /WORD: Ordinary gathering/);
});

test('shadowtag behaviour, aliases and admin-only access are unchanged', async () => {
  const loaded = await registry();
  const shadowtag = loaded.get('shadowtag');
  assert.equal(loaded.get('tagadmins'), shadowtag);
  assert.deepEqual(shadowtag.aliases, ['tagadmins']);
  assert.deepEqual(shadowtag.permissions, ['admin']);
  assert.equal(shadowtag.cooldownMs, 8000);
  assert.equal(shadowtag.category, 'domain');

  const { ctx, replies } = context({
    groupMeta: {
      participants: [
        { id: 'admin@s.whatsapp.net', admin: 'admin' },
        { id: 'member@s.whatsapp.net' },
        { id: 'bot@s.whatsapp.net', admin: 'admin' },
        { id: 'creator@s.whatsapp.net', admin: 'superadmin' },
      ],
    },
  });
  await shadowtag.execute(ctx);
  assert.equal(replies.length, 1);
  assert.deepEqual(replies[0].options.mentions, [
    'admin@s.whatsapp.net',
    'creator@s.whatsapp.net',
  ]);
  assert.match(replies[0].text, /SHADOWTAG/);
  assert.doesNotMatch(replies[0].text, /@member/);
});

test('broadcastMentions does not claim success when a later fallback batch fails', async () => {
  const calls = [];
  const result = await broadcastMentions(
    {
      reply: async (text, options) => {
        calls.push({ text, options });
        if (options.mentions.length > 8) throw payloadError();
        if (options.mentions[0] === 'user8@s.whatsapp.net') throw payloadError();
        return { ok: true };
      },
    },
    {
      participants: Array.from({ length: 16 }, (_, index) => `user${index}@s.whatsapp.net`),
      formatBatch(batch) {
        return { text: batch.join(' '), mentions: batch };
      },
    },
  );
  assert.equal(result.sent, 8);
  assert.equal(result.failed, 8);
  assert.equal(calls.length, 3);
});
