import { CommandError } from '../../lib/helpers.js';
import { fetchBuffer } from '../../lib/http.js';
import {
  IDENTITY_ASSETS,
  IDENTITY_SIGNATURES,
  formatIdentityCaption,
  quoteSignature,
  sendImageCaption,
} from '../../lib/ai-identity.js';

const GRACEFUL_MESSAGE = 'Nothing was invented in its place. Try again in a moment.';

function helpCaption(prefix) {
  return [
    'Isis generates an image or searches Unsplash photos.',
    `USAGE: ${prefix}isis <prompt>`,
    `USAGE: ${prefix}isis search <query>`,
  ].join('\n');
}

function isisCaption(body) {
  const text = String(body ?? '').trim();
  return text
    ? formatIdentityCaption(text, IDENTITY_SIGNATURES.isis)
    : quoteSignature(IDENTITY_SIGNATURES.isis);
}

function searchBody(photo) {
  const lines = [];
  if (photo.photographer) lines.push(photo.photographer);
  if (photo.attributionUrl) lines.push(photo.attributionUrl);
  return lines.join('\n');
}

function isImageBuffer(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return false;
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return true;
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) return true;
  if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46) return true;
  return (
    buffer[0] === 0x52 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x46 &&
    buffer[8] === 0x57 &&
    buffer[9] === 0x45 &&
    buffer[10] === 0x42 &&
    buffer[11] === 0x50
  );
}

async function sendRemoteImage(ctx, imageUrl, caption) {
  if (ctx.isAborted?.()) return;
  const timeoutMs = Number(ctx.config?.media?.timeoutMs);
  let buffer;
  try {
    buffer = await fetchBuffer(imageUrl, {
      timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 15000,
    });
  } catch {
    throw new CommandError('Isis could not retrieve the image.');
  }
  if (!isImageBuffer(buffer)) {
    throw new CommandError('Isis returned an invalid image.');
  }
  await sendImageCaption(ctx, { image: buffer, caption });
}

async function replyIsisFailure(ctx, error) {
  await sendImageCaption(ctx, {
    image: IDENTITY_ASSETS.isis,
    caption: isisCaption(`${error.message}\n${GRACEFUL_MESSAGE}`),
  });
}

export default {
  name: 'isis',
  aliases: [],
  description: 'Ask Isis to generate an image or search Unsplash photos.',
  category: 'ai',
  usage: 'isis <prompt|search <query>>',
  permissions: ['public'],
  cooldownMs: 10000,
  timeoutMs: 120000,
  async execute(ctx) {
    const argsText = String(ctx.argsText ?? '').trim();
    if (!argsText) {
      await sendImageCaption(ctx, {
        image: IDENTITY_ASSETS.isis,
        caption: helpCaption(ctx.prefix),
      });
      return;
    }

    const service = ctx.services?.isis;
    const [action, ...rest] = ctx.args;

    try {
      if (String(action).toLowerCase() === 'search') {
        if (!service || typeof service.search !== 'function') {
          throw new CommandError('Isis search is not bound to this vessel.');
        }

        const query = rest.join(' ').trim();
        const result = await service.search({ query });
        const photo = result?.photos?.[0];
        if (!photo?.imageUrl) {
          throw new CommandError('Isis found no photos for that search.');
        }

        const caption = isisCaption(searchBody(photo));
        await sendRemoteImage(ctx, photo.imageUrl, caption);
        return;
      }

      if (!service || typeof service.generate !== 'function') {
        throw new CommandError('Isis generation is not bound to this vessel.');
      }

      const result = await service.generate({ prompt: argsText });
      if (!result?.imageUrl) {
        throw new CommandError('Isis returned an invalid generation response.');
      }

      const caption = isisCaption();
      await sendRemoteImage(ctx, result.imageUrl, caption);
    } catch (error) {
      if (ctx.isAborted?.()) return;
      if (!(error instanceof CommandError)) throw error;
      await replyIsisFailure(ctx, error);
    }
  },
};
