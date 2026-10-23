import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { loadCommands } from '../lib/registry.js';
import { createLogger } from '../lib/logger.js';
import { CommandError } from '../lib/helpers.js';
import {
  CAPTION_LIMIT,
  IDENTITY_ASSETS,
  IDENTITY_SIGNATURES,
  formatIdentityCaption,
  quoteSignature,
} from '../lib/ai-identity.js';

const ROOT = path.resolve(import.meta.dirname, '..');
const logger = createLogger({ level: 'silent' });

const TEXT_IDENTITIES = [
  {
    name: 'akasha',
    serviceKey: 'ai',
    empty: /ask akasha/i,
    missing: /akasha is not bound/i,
  },
  {
    name: 'thoth',
    serviceKey: 'thoth',
    empty: /ask thoth/i,
    missing: /thoth is not bound/i,
  },
  {
    name: 'odin',
    serviceKey: 'odin',
    empty: /ask odin/i,
    missing: /odin is not bound/i,
  },
  {
    name: 'omen',
    serviceKey: 'omen',
    empty: /ask omen/i,
    missing: /omen is not bound/i,
  },
  {
    name: 'sage',
    serviceKey: 'sage',
    empty: /ask sage/i,
    missing: /sage is not bound/i,
  },
];

let registryPromise;
function registry() {
  registryPromise ??= loadCommands(path.join(ROOT, 'commands'), logger);
  return registryPromise;
}

function context(overrides = {}) {
  const replies = [];
  const contents = [];
  const ctx = {
    prefix: '!',
    args: [],
    argsText: '',
    senderJid: 'user@s.whatsapp.net',
    botJid: 'bot@s.whatsapp.net',
    isGroup: false,
    isOwner: false,
    isSudo: false,
    isAdmin: false,
    isBotAdmin: false,
    chatJid: 'user@s.whatsapp.net',
    config: { prefix: '!' },
    services: {},
    logger,
    reply: async (text, options = {}) => {
      replies.push({ text, options });
      return { ok: true };
    },
    replyContent: async (content, options = {}) => {
      contents.push({ content, options });
      return { ok: true };
    },
    ...overrides,
  };
  return { ctx, replies, contents };
}

test('registry discovers all six AI identity commands', async () => {
  const loaded = await registry();
  for (const name of ['akasha', 'thoth', 'odin', 'omen', 'sage', 'isis']) {
    const command = loaded.get(name);
    assert.ok(command, `missing command: ${name}`);
    assert.equal(command.name, name);
    assert.equal(command.category, 'ai');
    assert.match(command.usage, new RegExp(`^${name}\\b`));
    assert.equal(typeof command.execute, 'function');
    assert.deepEqual(command.permissions, ['public']);
    assert.match(command.source, new RegExp(`commands[\\\\/]ai[\\\\/]${name}\\.js$`));
  }
});

test('fixed identity assets exist and are not rotated', () => {
  for (const [name, assetPath] of Object.entries(IDENTITY_ASSETS)) {
    assert.equal(path.basename(assetPath), `${name}.jpg`);
    assert.equal(existsSync(assetPath), true, `missing asset: ${assetPath}`);
  }
});

test('text identity signatures are exact and quoted for WhatsApp', () => {
  assert.equal(
    IDENTITY_SIGNATURES.akasha,
    '✦ THE INFINITE ARCHIVE ✦\nKnowledge takes many forms. Seek understanding beyond the surface.',
  );
  assert.equal(
    IDENTITY_SIGNATURES.thoth,
    '𓂀 THE KEEPER OF WISDOM 𓂀\nEvery question opens a path. Every discovery adds another line to the scroll.',
  );
  assert.equal(
    IDENTITY_SIGNATURES.odin,
    '☥ THE ALLFATHER SPEAKS ☥\nWisdom is a weapon. Understanding is its mastery.',
  );
  assert.equal(
    IDENTITY_SIGNATURES.omen,
    '⛧ THE VOICE BEYOND THE VEIL ⛧\nEvery mystery casts a shadow. Not every shadow reveals its source.',
  );
  assert.equal(
    IDENTITY_SIGNATURES.sage,
    '✦ THE QUIET SAGE ✦\nPatience sharpens understanding. Wisdom begins where assumptions end.',
  );
  assert.equal(
    IDENTITY_SIGNATURES.isis,
    '𓆃 THE DIVINE ARTIST 𓆃\nImagination is the seed. Creation is the revelation.',
  );

  const quotedExact = {
    akasha:
      '> ✦ THE INFINITE ARCHIVE ✦\n> Knowledge takes many forms. Seek understanding beyond the surface.',
    thoth:
      '> 𓂀 THE KEEPER OF WISDOM 𓂀\n> Every question opens a path. Every discovery adds another line to the scroll.',
    odin:
      '> ☥ THE ALLFATHER SPEAKS ☥\n> Wisdom is a weapon. Understanding is its mastery.',
    omen:
      '> ⛧ THE VOICE BEYOND THE VEIL ⛧\n> Every mystery casts a shadow. Not every shadow reveals its source.',
    sage:
      '> ✦ THE QUIET SAGE ✦\n> Patience sharpens understanding. Wisdom begins where assumptions end.',
    isis:
      '> 𓆃 THE DIVINE ARTIST 𓆃\n> Imagination is the seed. Creation is the revelation.',
  };

  for (const [name, expected] of Object.entries(quotedExact)) {
    const [heading, tagline] = IDENTITY_SIGNATURES[name].split('\n');
    const quoted = quoteSignature(IDENTITY_SIGNATURES[name]);
    assert.equal(quoted, expected);
    assert.equal(quoted, `> ${heading}\n> ${tagline}`);
    assert.match(quoted, /^> /);
    assert.match(quoted, /\n> /);
    assert.equal(quoted.includes(`\n${heading}`), false);
    assert.equal(quoted.includes(`\n${tagline}`), false);
  }

  assert.equal(
    formatIdentityCaption('The archive answers.', IDENTITY_SIGNATURES.akasha),
    `The archive answers.\n\n${quotedExact.akasha}`,
  );
});

test('text identity commands require a prompt and do not call the service', async () => {
  const loaded = await registry();
  for (const identity of TEXT_IDENTITIES) {
    const calls = [];
    const { ctx } = context({
      services: {
        [identity.serviceKey]: {
          async chat(payload) {
            calls.push(payload);
            return 'should not run';
          },
        },
      },
    });
    await assert.rejects(
      () => loaded.get(identity.name).execute(ctx),
      (error) => {
        assert.equal(error instanceof CommandError, true);
        assert.match(error.message, identity.empty);
        assert.equal(error.message.includes(IDENTITY_SIGNATURES[identity.name]), false);
        return true;
      },
    );
    assert.deepEqual(calls, []);
  }
});

test('text identity commands reject a missing service without inventing an answer', async () => {
  const loaded = await registry();
  for (const identity of TEXT_IDENTITIES) {
    const { ctx, replies, contents } = context({
      args: ['hello'],
      argsText: 'hello',
    });
    await assert.rejects(
      () => loaded.get(identity.name).execute(ctx),
      (error) => {
        assert.equal(error instanceof CommandError, true);
        assert.match(error.message, identity.missing);
        assert.equal(error.message.includes(IDENTITY_SIGNATURES[identity.name]), false);
        return true;
      },
    );
    assert.equal(replies.length, 0);
    assert.equal(contents.length, 0);
  }
});

test('text identity commands pass the prompt and send image plus quoted signature', async () => {
  const loaded = await registry();
  for (const identity of TEXT_IDENTITIES) {
    const calls = [];
    const { ctx, replies, contents } = context({
      args: ['Explain', 'the', 'archive'],
      argsText: 'Explain the archive',
      services: {
        [identity.serviceKey]: {
          async chat(payload) {
            calls.push(payload);
            return `Answer from ${identity.name}`;
          },
        },
      },
    });

    await loaded.get(identity.name).execute(ctx);

    assert.deepEqual(calls, [{ prompt: 'Explain the archive' }]);
    assert.equal(replies.length, 0);
    assert.equal(contents.length, 1);
    assert.equal(contents[0].content.image.url, IDENTITY_ASSETS[identity.name]);
    const caption = contents[0].content.caption;
    const quoted = quoteSignature(IDENTITY_SIGNATURES[identity.name]);
    const [heading, tagline] = IDENTITY_SIGNATURES[identity.name].split('\n');
    assert.match(caption, new RegExp(`Answer from ${identity.name}`));
    assert.ok(caption.includes(quoted));
    assert.ok(caption.includes(`> ${heading}`));
    assert.ok(caption.includes(`> ${tagline}`));
    assert.ok(caption.startsWith(`Answer from ${identity.name}`));
    assert.ok(caption.length <= CAPTION_LIMIT);
  }
});

test('oversized identity answers are preserved as follow-up text', async () => {
  const loaded = await registry();
  const answer = 'A'.repeat(CAPTION_LIMIT);
  const { ctx, replies, contents } = context({
    args: ['long'],
    argsText: 'long',
    services: {
      ai: {
        async chat() {
          return answer;
        },
      },
    },
  });

  await loaded.get('akasha').execute(ctx);

  assert.equal(contents.length, 1);
  assert.equal(contents[0].content.image.url, IDENTITY_ASSETS.akasha);
  assert.equal(contents[0].content.caption, undefined);
  assert.equal(replies.length, 1);
  assert.equal(replies[0].text, formatIdentityCaption(answer, IDENTITY_SIGNATURES.akasha));
  assert.ok(replies[0].text.includes(answer));
  assert.ok(replies[0].text.includes(quoteSignature(IDENTITY_SIGNATURES.akasha)));
});

test('service failures are rethrown without appending a signature', async () => {
  const loaded = await registry();
  const { ctx, replies, contents } = context({
    args: ['fail'],
    argsText: 'fail',
    services: {
      ai: {
        async chat() {
          throw new CommandError('The AI service timed out before answering.');
        },
      },
    },
  });

  await assert.rejects(
    () => loaded.get('akasha').execute(ctx),
    (error) => {
      assert.equal(error instanceof CommandError, true);
      assert.equal(error.message, 'The AI service timed out before answering.');
      assert.equal(error.message.includes(IDENTITY_SIGNATURES.akasha), false);
      return true;
    },
  );
  assert.equal(replies.length, 0);
  assert.equal(contents.length, 0);
});

test('empty AI answers are rejected without a signature', async () => {
  const loaded = await registry();
  const { ctx, replies, contents } = context({
    args: ['blank'],
    argsText: 'blank',
    services: {
      ai: {
        async chat() {
          return '   ';
        },
      },
    },
  });

  await assert.rejects(
    () => loaded.get('akasha').execute(ctx),
    (error) => {
      assert.equal(error instanceof CommandError, true);
      assert.match(error.message, /empty revelation/i);
      assert.equal(error.message.includes(IDENTITY_SIGNATURES.akasha), false);
      return true;
    },
  );
  assert.equal(replies.length, 0);
  assert.equal(contents.length, 0);
});

test('isis empty prompt presents the identity image and usage', async () => {
  const loaded = await registry();
  const calls = [];
  const { ctx, contents, replies } = context({
    services: {
      isis: {
        async generate(payload) {
          calls.push(['generate', payload]);
          return { imageUrl: 'https://cdn.example.test/generated.png' };
        },
        async search(payload) {
          calls.push(['search', payload]);
          return { photos: [] };
        },
      },
    },
  });

  await loaded.get('isis').execute(ctx);

  assert.deepEqual(calls, []);
  assert.equal(replies.length, 0);
  assert.equal(contents.length, 1);
  assert.equal(contents[0].content.image.url, IDENTITY_ASSETS.isis);
  assert.match(contents[0].content.caption, /USAGE: !isis <prompt>/);
  assert.match(contents[0].content.caption, /USAGE: !isis search <query>/);
});

test('isis generate preserves generated media with the divine artist signature', async () => {
  const loaded = await registry();
  const generated = 'https://cdn.example.test/generated.png';
  const calls = [];
  const { ctx, contents, replies } = context({
    args: ['a', 'crimson', 'shrine'],
    argsText: 'a crimson shrine',
    services: {
      isis: {
        async generate(payload) {
          calls.push(payload);
          return { imageUrl: generated };
        },
        async search() {
          throw new Error('search should not run');
        },
      },
    },
  });

  await loaded.get('isis').execute(ctx);

  assert.deepEqual(calls, [{ prompt: 'a crimson shrine' }]);
  assert.equal(replies.length, 0);
  assert.equal(contents.length, 1);
  assert.equal(contents[0].content.image.url, generated);
  assert.notEqual(contents[0].content.image.url, IDENTITY_ASSETS.isis);
  const quoted = quoteSignature(IDENTITY_SIGNATURES.isis);
  assert.equal(contents[0].content.caption, quoted);
  assert.ok(quoted.startsWith('> 𓆃 THE DIVINE ARTIST 𓆃'));
  assert.ok(quoted.includes('\n> Imagination is the seed. Creation is the revelation.'));
});

test('isis search preserves the first photo, attribution, and signature', async () => {
  const loaded = await registry();
  const photoUrl = 'https://images.unsplash.com/photo-test';
  const calls = [];
  const { ctx, contents } = context({
    args: ['search', 'temple', 'columns'],
    argsText: 'search temple columns',
    services: {
      isis: {
        async generate() {
          throw new Error('generate should not run');
        },
        async search(payload) {
          calls.push(payload);
          return {
            photos: [
              {
                imageUrl: photoUrl,
                photographer: 'Test Photographer',
                attributionUrl: 'https://unsplash.com/photos/test',
              },
            ],
          };
        },
      },
    },
  });

  await loaded.get('isis').execute(ctx);

  assert.deepEqual(calls, [{ query: 'temple columns' }]);
  assert.equal(contents.length, 1);
  assert.equal(contents[0].content.image.url, photoUrl);
  assert.notEqual(contents[0].content.image.url, IDENTITY_ASSETS.isis);
  const caption = contents[0].content.caption;
  assert.match(caption, /Test Photographer/);
  assert.match(caption, /https:\/\/unsplash.com\/photos\/test/);
  assert.ok(caption.includes('> 𓆃 THE DIVINE ARTIST 𓆃'));
  assert.ok(caption.includes('> Imagination is the seed. Creation is the revelation.'));
  assert.ok(caption.includes(quoteSignature(IDENTITY_SIGNATURES.isis)));
});

function assertIsisFallback(contents, replies, message) {
  assert.equal(replies.length, 0);
  assert.equal(contents.length, 1);
  assert.equal(contents[0].content.image.url, IDENTITY_ASSETS.isis);
  const caption = contents[0].content.caption;
  assert.match(caption, message);
  assert.match(caption, /Nothing was invented in its place/);
  assert.ok(caption.includes('> 𓆃 THE DIVINE ARTIST 𓆃'));
  assert.ok(caption.includes('> Imagination is the seed. Creation is the revelation.'));
  assert.ok(caption.includes(quoteSignature(IDENTITY_SIGNATURES.isis)));
}

test('isis generation and search errors send the identity image with a graceful signature', async () => {
  const loaded = await registry();

  const missing = context({
    args: ['storm'],
    argsText: 'storm',
  });
  await loaded.get('isis').execute(missing.ctx);
  assertIsisFallback(missing.contents, missing.replies, /generation is not bound/i);

  const emptySearch = context({
    args: ['search'],
    argsText: 'search',
    services: {
      isis: {
        async search({ query }) {
          throw new CommandError(
            typeof query === 'string' && !query.trim()
              ? 'Isis requires a search query.'
              : 'unexpected',
          );
        },
      },
    },
  });
  await loaded.get('isis').execute(emptySearch.ctx);
  assertIsisFallback(emptySearch.contents, emptySearch.replies, /requires a search query/i);

  const failed = context({
    args: ['storm'],
    argsText: 'storm',
    services: {
      isis: {
        async generate() {
          throw new CommandError('Isis could not be reached.');
        },
      },
    },
  });
  await loaded.get('isis').execute(failed.ctx);
  assertIsisFallback(failed.contents, failed.replies, /could not be reached/i);

  const timedOut = context({
    args: ['search', 'temple'],
    argsText: 'search temple',
    services: {
      isis: {
        async search() {
          throw new CommandError('Isis timed out before finishing the photo search.');
        },
      },
    },
  });
  await loaded.get('isis').execute(timedOut.ctx);
  assertIsisFallback(timedOut.contents, timedOut.replies, /timed out/i);
});

test('isis missing generated or searched images use the identity fallback', async () => {
  const loaded = await registry();

  const missingGenerated = context({
    args: ['storm'],
    argsText: 'storm',
    services: {
      isis: {
        async generate() {
          return { imageUrl: '' };
        },
      },
    },
  });
  await loaded.get('isis').execute(missingGenerated.ctx);
  assertIsisFallback(
    missingGenerated.contents,
    missingGenerated.replies,
    /invalid generation response/i,
  );

  const emptyResults = context({
    args: ['search', 'void'],
    argsText: 'search void',
    services: {
      isis: {
        async search() {
          return { photos: [] };
        },
      },
    },
  });
  await loaded.get('isis').execute(emptyResults.ctx);
  assertIsisFallback(emptyResults.contents, emptyResults.replies, /found no photos/i);

  const missingPhotoUrl = context({
    args: ['search', 'void'],
    argsText: 'search void',
    services: {
      isis: {
        async search() {
          return { photos: [{ photographer: 'Nobody' }] };
        },
      },
    },
  });
  await loaded.get('isis').execute(missingPhotoUrl.ctx);
  assertIsisFallback(missingPhotoUrl.contents, missingPhotoUrl.replies, /found no photos/i);
});
