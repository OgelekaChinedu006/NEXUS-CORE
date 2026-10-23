import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CommandError, isHttpUrl } from './helpers.js';

export const CAPTION_LIMIT = 1024;

const ASSETS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  'assets/ai',
);

export const IDENTITY_ASSETS = Object.freeze({
  akasha: path.join(ASSETS_DIR, 'akasha.jpg'),
  thoth: path.join(ASSETS_DIR, 'thoth.jpg'),
  odin: path.join(ASSETS_DIR, 'odin.jpg'),
  omen: path.join(ASSETS_DIR, 'omen.jpg'),
  sage: path.join(ASSETS_DIR, 'sage.jpg'),
  isis: path.join(ASSETS_DIR, 'isis.jpg'),
});

export const IDENTITY_SIGNATURES = Object.freeze({
  akasha: [
    '✦ THE INFINITE ARCHIVE ✦',
    'Knowledge takes many forms. Seek understanding beyond the surface.',
  ].join('\n'),
  thoth: [
    '𓂀 THE KEEPER OF WISDOM 𓂀',
    'Every question opens a path. Every discovery adds another line to the scroll.',
  ].join('\n'),
  odin: [
    '☥ THE ALLFATHER SPEAKS ☥',
    'Wisdom is a weapon. Understanding is its mastery.',
  ].join('\n'),
  omen: [
    '⛧ THE VOICE BEYOND THE VEIL ⛧',
    'Every mystery casts a shadow. Not every shadow reveals its source.',
  ].join('\n'),
  sage: [
    '✦ THE QUIET SAGE ✦',
    'Patience sharpens understanding. Wisdom begins where assumptions end.',
  ].join('\n'),
  isis: [
    '𓆃 THE DIVINE ARTIST 𓆃',
    'Imagination is the seed. Creation is the revelation.',
  ].join('\n'),
});

export function quoteSignature(signature) {
  return String(signature)
    .split('\n')
    .map((line) => (line === '' ? '>' : `> ${line}`))
    .join('\n');
}

export function formatIdentityCaption(answer, signature) {
  return `${String(answer).trimEnd()}\n\n${quoteSignature(signature)}`;
}

export function splitCaption(text, limit = CAPTION_LIMIT) {
  const value = String(text ?? '');
  if (value.length <= limit) {
    return { caption: value, rest: '' };
  }

  let index = value.lastIndexOf('\n', limit);
  if (index < Math.floor(limit / 2)) {
    index = limit;
  }

  const caption = value.slice(0, index);
  const rest = value.slice(index).replace(/^\n/, '');
  return { caption, rest };
}

export function requirePrompt(argsText, message) {
  const prompt = String(argsText ?? '').trim();
  if (!prompt) throw new CommandError(message);
  return prompt;
}

function canSendImage(ctx, image) {
  if (typeof ctx.replyContent !== 'function' || !image) return false;
  if (Buffer.isBuffer(image)) return image.length > 0;
  if (isHttpUrl(image)) return true;
  return typeof image === 'string' && existsSync(image);
}

function toImageMedia(image) {
  return Buffer.isBuffer(image) ? image : { url: image };
}

export async function sendImageCaption(ctx, { image, caption = '', fallbackText } = {}) {
  if (ctx.isAborted?.()) return;

  const text = String(caption || '');
  if (canSendImage(ctx, image)) {
    try {
      const media = toImageMedia(image);
      if (!text) {
        await ctx.replyContent({ image: media });
        return;
      }
      if (text.length <= CAPTION_LIMIT) {
        await ctx.replyContent({ image: media, caption: text });
        return;
      }
      const { caption: head, rest } = splitCaption(text);
      await ctx.replyContent({ image: media, caption: head });
      if (rest) await ctx.reply(rest);
      return;
    } catch (error) {
      if (ctx.isAborted?.()) return;
      ctx.logger?.warn?.(`Identity media delivery failed: ${error.message}`);
    }
  }

  if (ctx.isAborted?.()) return;
  const fallback = fallbackText || text;
  if (fallback) await ctx.reply(fallback);
}

export async function replyIdentity(ctx, { name, answer }) {
  const signature = IDENTITY_SIGNATURES[name];
  const image = IDENTITY_ASSETS[name];
  const caption = formatIdentityCaption(answer, signature);
  await sendImageCaption(ctx, { image, caption });
}

export function createTextIdentityCommand({
  name,
  aliases = [],
  description,
  usage,
  serviceKey,
  emptyPromptMessage,
  missingServiceMessage,
  cooldownMs = 10000,
}) {
  return {
    name,
    aliases,
    description,
    category: 'ai',
    usage,
    permissions: ['public'],
    cooldownMs,
    async execute(ctx) {
      const prompt = requirePrompt(ctx.argsText, emptyPromptMessage);
      const service = ctx.services?.[serviceKey];
      if (!service || typeof service.chat !== 'function') {
        throw new CommandError(missingServiceMessage);
      }

      const answer = await service.chat({ prompt });
      if (typeof answer !== 'string' || !answer.trim()) {
        throw new CommandError('The AI service returned an empty revelation.');
      }

      await replyIdentity(ctx, { name, answer: answer.trim() });
    },
  };
}
