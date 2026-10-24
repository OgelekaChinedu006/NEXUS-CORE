import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { loadCommands } from '../lib/registry.js';
import { createLogger } from '../lib/logger.js';
import { CommandError } from '../lib/helpers.js';
import {
  DELIVERY_FAILED,
  MISSING_QUOTE,
  OWNER_MISSING,
  RETRIEVAL_FAILED,
  UNSUPPORTED,
  VV_SUCCESS_MESSAGE,
  inspectViewOnceMessage,
  ownerRevealCaption,
  recoverQuotedViewOnce,
  resolveOwnerDestination,
  toSendContent,
} from '../lib/view-once.js';

const ROOT = path.resolve(import.meta.dirname, '..');
const logger = createLogger({ level: 'silent' });
const OWNER = 'owner@s.whatsapp.net';
const GROUP = '120363000000000000@g.us';
const SENDER = 'member@s.whatsapp.net';
const IMAGE = Buffer.from('fake-image');
const VIDEO = Buffer.from('fake-video');
const AUDIO = Buffer.from('fake-audio');

let registryPromise;
function registry() {
  registryPromise ??= loadCommands(path.join(ROOT, 'commands'), logger);
  return registryPromise;
}

function viewOnceWrap(inner, wrapper = 'viewOnceMessage') {
  return { [wrapper]: { message: inner } };
}

function quotedImage(overrides = {}, wrapper = 'viewOnceMessage') {
  return viewOnceWrap(
    {
      imageMessage: {
        mimetype: 'image/jpeg',
        caption: 'hidden still',
        ...overrides,
      },
    },
    wrapper,
  );
}

function quotedVideo(overrides = {}, wrapper = 'viewOnceMessageV2') {
  return viewOnceWrap(
    {
      videoMessage: {
        mimetype: 'video/mp4',
        caption: 'hidden motion',
        ...overrides,
      },
    },
    wrapper,
  );
}

function quotedAudio({ ptt = false, ...overrides } = {}, wrapper = 'viewOnceMessageV2Extension') {
  return viewOnceWrap(
    {
      audioMessage: {
        mimetype: ptt ? 'audio/ogg; codecs=opus' : 'audio/mpeg',
        ptt,
        ...overrides,
      },
    },
    wrapper,
  );
}

function context(overrides = {}) {
  const replies = [];
  const contents = [];
  const sent = [];
  const ctx = {
    prefix: '!',
    args: [],
    argsText: '',
    senderJid: OWNER,
    botJid: 'bot@s.whatsapp.net',
    chatJid: GROUP,
    isGroup: true,
    isOwner: true,
    isSudo: false,
    config: { ownerJid: OWNER, ownerDisplay: 'The Sovereign' },
    groupMeta: { subject: 'Test Domain' },
    quoted: null,
    logger,
    sock: {
      async sendMessage(jid, content) {
        sent.push({ jid, content });
        return { key: { id: `owner-${sent.length}` } };
      },
    },
    reply: async (text) => {
      replies.push({ text });
      return { ok: true };
    },
    replyContent: async (content) => {
      contents.push(content);
      return { key: { id: `chat-${contents.length}` } };
    },
    downloadViewOnce: async () => IMAGE,
    ...overrides,
  };
  return { ctx, replies, contents, sent };
}

test('vv and vv2 are independently registered under Sovereign without aliases or duplicates', async () => {
  const loaded = await registry();
  const vv = loaded.get('vv');
  const vv2 = loaded.get('vv2');

  assert.ok(vv);
  assert.ok(vv2);
  assert.notEqual(vv, vv2);
  assert.equal(vv.category, 'sovereign');
  assert.equal(vv2.category, 'sovereign');
  assert.deepEqual(vv.permissions, ['owner']);
  assert.deepEqual(vv2.permissions, ['owner']);
  assert.deepEqual(vv.aliases, []);
  assert.deepEqual(vv2.aliases, []);
  assert.equal(vv.usage, 'vv');
  assert.equal(vv2.usage, 'vv2');
  assert.equal(loaded.get('vv'), vv);
  assert.equal(loaded.get('vv2'), vv2);

  const sovereign = loaded.all().filter((command) => command.category === 'sovereign');
  assert.equal(sovereign.filter((command) => command.name === 'vv').length, 1);
  assert.equal(sovereign.filter((command) => command.name === 'vv2').length, 1);
});

test('inspectViewOnceMessage unwraps view-once wrappers, ephemeral nesting and flagged media', () => {
  const image = inspectViewOnceMessage(quotedImage());
  assert.equal(image.ok, true);
  assert.equal(image.kind, 'image');
  assert.equal(image.mimetype, 'image/jpeg');
  assert.equal(image.caption, 'hidden still');

  const video = inspectViewOnceMessage({
    ephemeralMessage: { message: quotedVideo() },
  });
  assert.equal(video.ok, true);
  assert.equal(video.kind, 'video');
  assert.equal(video.mimetype, 'video/mp4');

  const voice = inspectViewOnceMessage(
    quotedAudio({ ptt: true }, 'viewOnceMessageV2Extension'),
  );
  assert.equal(voice.ok, true);
  assert.equal(voice.kind, 'voice');
  assert.equal(voice.ptt, true);

  const flagged = inspectViewOnceMessage({
    imageMessage: { viewOnce: true, mimetype: 'image/png' },
  });
  assert.equal(flagged.ok, true);
  assert.equal(flagged.kind, 'image');
  assert.equal(flagged.mimetype, 'image/png');
});

test('inspectViewOnceMessage rejects missing, plain and unsupported messages', () => {
  assert.equal(inspectViewOnceMessage(null).ok, false);
  assert.equal(inspectViewOnceMessage({ conversation: 'nope' }).reason, UNSUPPORTED);
  assert.equal(
    inspectViewOnceMessage({ imageMessage: { mimetype: 'image/jpeg' } }).reason,
    UNSUPPORTED,
  );
  assert.equal(
    inspectViewOnceMessage(viewOnceWrap({ stickerMessage: { mimetype: 'image/webp' } })).reason,
    UNSUPPORTED,
  );
  assert.equal(
    inspectViewOnceMessage(viewOnceWrap({ documentMessage: { mimetype: 'application/pdf' } })).reason,
    UNSUPPORTED,
  );
});

test('recoverQuotedViewOnce requires a quoted view-once message and a usable buffer', async () => {
  await assert.rejects(() => recoverQuotedViewOnce({ quoted: null }), (error) => {
    assert.equal(error instanceof CommandError, true);
    assert.equal(error.message, MISSING_QUOTE);
    return true;
  });

  await assert.rejects(
    () => recoverQuotedViewOnce({ quoted: { message: { conversation: 'text' } } }),
    (error) => {
      assert.equal(error.message, UNSUPPORTED);
      return true;
    },
  );

  await assert.rejects(
    () =>
      recoverQuotedViewOnce({
        quoted: { message: quotedImage() },
        downloadViewOnce: async () => {
          throw new Error('cdn down');
        },
      }),
    (error) => {
      assert.equal(error instanceof CommandError, true);
      assert.equal(error.message, RETRIEVAL_FAILED);
      return true;
    },
  );

  await assert.rejects(
    () =>
      recoverQuotedViewOnce({
        quoted: { message: quotedImage() },
        downloadViewOnce: async () => Buffer.alloc(0),
      }),
    /could not be retrieved/,
  );

  const recovered = await recoverQuotedViewOnce({
    quoted: { message: quotedImage() },
    downloadViewOnce: async () => IMAGE,
  });
  assert.equal(recovered.kind, 'image');
  assert.equal(recovered.buffer, IMAGE);
});

test('!vv delivers recovered image, video and audio to the current chat then the exact success line', async () => {
  const loaded = await registry();
  const command = loaded.get('vv');

  const imageCase = context({
    quoted: { message: quotedImage(), participant: SENDER },
    downloadViewOnce: async () => IMAGE,
  });
  await command.execute(imageCase.ctx);
  assert.equal(imageCase.contents.length, 1);
  assert.equal(imageCase.contents[0].image, IMAGE);
  assert.equal(imageCase.contents[0].mimetype, 'image/jpeg');
  assert.equal(imageCase.contents[0].caption, 'hidden still');
  assert.equal(imageCase.replies.length, 1);
  assert.equal(imageCase.replies[0].text, VV_SUCCESS_MESSAGE);
  assert.equal(imageCase.replies[0].text, 'Nothing stays hidden before the King.');
  assert.equal(imageCase.sent.length, 0);

  const videoCase = context({
    quoted: { message: quotedVideo() },
    downloadViewOnce: async () => VIDEO,
  });
  await command.execute(videoCase.ctx);
  assert.equal(videoCase.contents[0].video, VIDEO);
  assert.equal(videoCase.contents[0].mimetype, 'video/mp4');
  assert.equal(videoCase.replies.at(-1).text, VV_SUCCESS_MESSAGE);

  const audioCase = context({
    quoted: { message: quotedAudio({ ptt: true }) },
    downloadViewOnce: async () => AUDIO,
  });
  await command.execute(audioCase.ctx);
  assert.equal(audioCase.contents[0].audio, AUDIO);
  assert.equal(audioCase.contents[0].ptt, true);
  assert.equal(audioCase.replies.at(-1).text, VV_SUCCESS_MESSAGE);
});

test('!vv does not claim success when the quote, media, download or delivery fails', async () => {
  const loaded = await registry();
  const command = loaded.get('vv');

  const missing = context();
  await assert.rejects(() => command.execute(missing.ctx), CommandError);
  assert.equal(missing.contents.length, 0);
  assert.equal(missing.replies.length, 0);

  const unsupported = context({ quoted: { message: { conversation: 'plain' } } });
  await assert.rejects(() => command.execute(unsupported.ctx), /not a view-once/);
  assert.equal(unsupported.contents.length, 0);
  assert.doesNotMatch(JSON.stringify(unsupported.replies), /Nothing stays hidden/);

  const downloadFail = context({
    quoted: { message: quotedImage() },
    downloadViewOnce: async () => {
      throw new Error('expired');
    },
  });
  await assert.rejects(() => command.execute(downloadFail.ctx), /could not be retrieved/);
  assert.equal(downloadFail.contents.length, 0);
  assert.equal(downloadFail.replies.length, 0);

  const deliveryThrow = context({
    quoted: { message: quotedImage() },
    replyContent: async () => {
      throw new Error('send failed');
    },
  });
  await assert.rejects(() => command.execute(deliveryThrow.ctx), (error) => {
    assert.equal(error.message, DELIVERY_FAILED);
    return true;
  });
  assert.equal(deliveryThrow.replies.length, 0);

  const deliveryNull = context({
    quoted: { message: quotedImage() },
    replyContent: async () => null,
  });
  await assert.rejects(() => command.execute(deliveryNull.ctx), /could not be delivered/);
  assert.equal(deliveryNull.replies.length, 0);
});

test('!vv2 delivers recovered media only to the configured owner DM', async () => {
  const loaded = await registry();
  const command = loaded.get('vv2');
  const { ctx, replies, contents, sent } = context({
    quoted: { message: quotedImage(), participant: SENDER },
    downloadViewOnce: async () => IMAGE,
  });

  await command.execute(ctx);

  assert.equal(contents.length, 0);
  assert.equal(replies.length, 0);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].jid, OWNER);
  assert.equal(sent[0].content.image, IMAGE);
  assert.equal(sent[0].content.mimetype, 'image/jpeg');
  assert.match(sent[0].content.caption, /Recovered view-once image/);
  assert.match(sent[0].content.caption, new RegExp(`Origin: ${GROUP}`));
  assert.match(sent[0].content.caption, /Group: Test Domain/);
  assert.match(sent[0].content.caption, new RegExp(`Sender: ${SENDER}`));
  assert.match(sent[0].content.caption, /hidden still/);
  assert.doesNotMatch(JSON.stringify(replies), /Nothing stays hidden/);
});

test('!vv2 sends supported video and voice to the owner without touching the origin chat', async () => {
  const loaded = await registry();
  const command = loaded.get('vv2');

  const videoCase = context({
    quoted: { message: quotedVideo(), participant: SENDER },
    downloadViewOnce: async () => VIDEO,
  });
  await command.execute(videoCase.ctx);
  assert.equal(videoCase.contents.length, 0);
  assert.equal(videoCase.replies.length, 0);
  assert.equal(videoCase.sent[0].jid, OWNER);
  assert.equal(videoCase.sent[0].content.video, VIDEO);

  const voiceCase = context({
    quoted: { message: quotedAudio({ ptt: true }), participant: SENDER },
    downloadViewOnce: async () => AUDIO,
  });
  await command.execute(voiceCase.ctx);
  assert.equal(voiceCase.contents.length, 0);
  assert.equal(voiceCase.replies.length, 0);
  assert.equal(voiceCase.sent[0].jid, OWNER);
  assert.equal(voiceCase.sent[0].content.audio, AUDIO);
  assert.equal(voiceCase.sent[0].content.ptt, true);
  assert.equal(voiceCase.sent[1].jid, OWNER);
  assert.match(voiceCase.sent[1].content.text, /Recovered view-once voice/);
  assert.match(voiceCase.sent[1].content.text, new RegExp(`Origin: ${GROUP}`));
});

test('!vv2 fails safely when the owner JID is missing or invalid and never leaks media', async () => {
  const loaded = await registry();
  const command = loaded.get('vv2');

  for (const ownerJid of [null, '', 'not-a-jid', GROUP]) {
    const { ctx, replies, contents, sent } = context({
      config: { ownerJid },
      quoted: { message: quotedImage() },
    });
    await assert.rejects(() => command.execute(ctx), (error) => {
      assert.equal(error instanceof CommandError, true);
      assert.equal(error.message, OWNER_MISSING);
      return true;
    });
    assert.equal(contents.length, 0);
    assert.equal(replies.length, 0);
    assert.equal(sent.length, 0);
  }
});

test('!vv2 retrieval and delivery failures do not send media or a success report to the origin', async () => {
  const loaded = await registry();
  const command = loaded.get('vv2');

  const missing = context({ quoted: null });
  await assert.rejects(() => command.execute(missing.ctx), /Reply directly/);
  assert.equal(missing.sent.length, 0);
  assert.equal(missing.contents.length, 0);
  assert.equal(missing.replies.length, 0);

  const downloadFail = context({
    quoted: { message: quotedImage() },
    downloadViewOnce: async () => {
      throw new Error('gone');
    },
  });
  await assert.rejects(() => command.execute(downloadFail.ctx), /could not be retrieved/);
  assert.equal(downloadFail.sent.length, 0);
  assert.equal(downloadFail.contents.length, 0);

  const deliveryFail = context({
    quoted: { message: quotedImage() },
    sock: {
      async sendMessage() {
        throw new Error('dm closed');
      },
    },
  });
  await assert.rejects(() => command.execute(deliveryFail.ctx), /could not be delivered/);
  assert.equal(deliveryFail.contents.length, 0);
  assert.equal(deliveryFail.replies.length, 0);
});

test('owner destination and send payload helpers stay strict', () => {
  assert.equal(resolveOwnerDestination({ config: { ownerJid: OWNER } }), OWNER);
  assert.throws(() => resolveOwnerDestination({ config: { ownerJid: null } }), CommandError);
  assert.throws(() => resolveOwnerDestination({ config: { ownerJid: GROUP } }), CommandError);

  const payload = toSendContent({
    kind: 'image',
    buffer: IMAGE,
    mimetype: 'image/jpeg',
    caption: 'kept',
  });
  assert.deepEqual(payload, { image: IMAGE, mimetype: 'image/jpeg', caption: 'kept' });

  const caption = ownerRevealCaption(
    { chatJid: GROUP, isGroup: true, groupMeta: { subject: 'Test Domain' }, quoted: { participant: SENDER } },
    { kind: 'image', caption: 'hidden still' },
  );
  assert.match(caption, /Recovered view-once image/);
  assert.match(caption, /hidden still/);
  assert.doesNotMatch(caption, /unknown timestamp/i);
});
