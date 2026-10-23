import { CommandError } from '../../lib/helpers.js';
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
        await sendImageCaption(ctx, {
          image: photo.imageUrl,
          caption,
          fallbackText: [photo.imageUrl, caption].filter(Boolean).join('\n'),
        });
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
      await sendImageCaption(ctx, {
        image: result.imageUrl,
        caption,
        fallbackText: [result.imageUrl, caption].filter(Boolean).join('\n'),
      });
    } catch (error) {
      if (!(error instanceof CommandError)) throw error;
      await replyIsisFailure(ctx, error);
    }
  },
};
