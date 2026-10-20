import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fullFrame, menu } from '../../lib/formatter.js';
import { pick } from '../../lib/helpers.js';

const CAPTION_LIMIT = 1024;
const ASSETS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../lib/assets',
);


const recentBanners = [];

function selectBanner() {
  if (!existsSync(ASSETS_DIR)) return null;

  try {
    const assets = readdirSync(ASSETS_DIR, { withFileTypes: true })
      .filter((entry) => entry.isFile() && /\.jpe?g$/i.test(entry.name))
      .map((entry) => path.join(ASSETS_DIR, entry.name))
      .sort();

    if (assets.length === 0) return null;

    const available = assets.filter(
      (asset) => !recentBanners.includes(asset),
    );
    const selected = pick(available.length > 0 ? available : assets);

    if (!selected) return null;

    recentBanners.push(selected);
    if (recentBanners.length > 2) recentBanners.shift();

    return selected;
  } catch {
    return null;
  }
}



// function selectBanner() {
//   if (!existsSync(ASSETS_DIR)) return null;
//   try {
//     const assets = readdirSync(ASSETS_DIR, { withFileTypes: true })
//       .filter((entry) => entry.isFile() && /\.jpe?g$/i.test(entry.name))
//       .map((entry) => path.join(ASSETS_DIR, entry.name))
//       .sort();
//     return pick(assets) || null;
//   } catch {
//     return null;
//   }
// }

function buildCaption(params) {
  const full = menu(params);
  if (full.length <= CAPTION_LIMIT) return full;

  const { prefix, version, categories, total, botName, slogan } = params;
  const header = [
    `╭━━━〔 ${String(botName).toUpperCase()} 〕━━━╮`,
    `┃ PREFIX: ${prefix} • COMMANDS: ${total} • VERSION: ${version}`,
  ];
  const footer = '╰━━━━━━━━━━━━━━━━━━━━╯';
  const sections = categories.flatMap((category) => [
    `┣━━〔 ✦ ${category.label.toUpperCase()} 〕`,
    ...category.commands.map((command) => `┃ ⌁ ${prefix}${command.name}`),
  ]);
  const withSlogan = slogan ? [...header, `┃ ✦ ${slogan}`] : header;
  const structured = [...withSlogan, ...sections, footer].join('\n');
  if (structured.length <= CAPTION_LIMIT) return structured;

  const withoutSlogan = [...header, ...sections, footer].join('\n');
  if (withoutSlogan.length <= CAPTION_LIMIT) return withoutSlogan;

  const compactSections = categories.flatMap((category) => [
    `┣━━〔 ✦ ${category.label.toUpperCase()} 〕`,
    category.commands.map((command) => `${prefix}${command.name}`).join(', '),
  ]);
  const compact = [...header, ...compactSections, footer].join('\n');
  if (compact.length <= CAPTION_LIMIT) return compact;

  const summaries = categories.map(
    (category) => `┃ ${category.label.toUpperCase()} (${category.commands.length})`,
  );
  for (const lines of [
    [...header, ...summaries, footer],
    [...header, ...categories.map((category) => `┃ ${category.label.toUpperCase()}`), footer],
    header,
  ]) {
    const text = lines.join('\n');
    if (text.length <= CAPTION_LIMIT) return text;
  }
  return header.join('\n');
}

export default {
  name: 'arise',
  aliases: ['menu', 'commands'],
  description: 'Reveal every bound curse, grouped by domain.',
  category: 'general',
  usage: 'arise [category]',
  permissions: ['public'],
  cooldownMs: 3000,
  async execute(ctx) {
    const filter = (ctx.args[0] || '').toLowerCase();
    const categories = ctx.registry.categories();
    const visible = filter
      ? categories.filter(
          (category) =>
            category.id === filter ||
            category.label.toLowerCase() === filter ||
            category.label.toLowerCase().replace(/\s+/g, '') === filter,
        )
      : categories;

    if (filter && visible.length === 0) {
      await ctx.reply(
        fullFrame('☠️ UNKNOWN DOMAIN', [
          `No category named "${filter}" is bound.`,
          '',
          'Available domains:',
          ...categories.map((category) => `▸ ${category.label} — ${ctx.prefix}arise ${category.id}`),
          '',
          `> ${ctx.prefix}beg <command> reveals a single curse.`,
        ]),
      );
      return;
    }

    const menuParams = {
      prefix: ctx.prefix,
      version: ctx.config.version,
      categories: visible,
      total: ctx.registry.size,
      botName: ctx.config.botName,
      slogan: ctx.config.shrine.slogan,
    };
    const menuText = menu(menuParams);

    const banner = typeof ctx.replyContent === 'function' ? selectBanner() : null;
    if (!banner) {
      await ctx.reply(menuText);
      return;
    }

    try {
      await ctx.replyContent({ image: { url: banner }, caption: buildCaption(menuParams) });
    } catch (error) {
      ctx.logger?.warn?.(`Shrine banner delivery failed: ${error.message}`);
      await ctx.reply(menuText);
    }
  },
};
