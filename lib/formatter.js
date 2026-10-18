import { FOOTER, BOT_NAME } from '../config/config.js';
import { displayMention, sanitizeField } from './helpers.js';

const TOP = '╭━━━〔';
const TOP_END = '〕━━━╮';
const BOTTOM = '╰━━━━━━━━━━━━━━━━━━━━╯';
const DIVIDER = '┣━━━━━━━━━━━━━━━━━━━━';

function toLines(lines) {
  const flat = [];
  for (const line of lines ?? []) {
    if (Array.isArray(line)) flat.push(...line);
    else if (line !== null && line !== undefined && line !== '') flat.push(String(line));
  }
  return flat;
}

export function fullFrame(title, lines = [], { showFooter = true, footer = FOOTER } = {}) {
  const body = toLines(lines).map((line) => (line === '' ? '┃' : `┃ ${line}`));
  const parts = [`${TOP} ${title} ${TOP_END}`, ...(body.length ? [DIVIDER, ...body] : []), BOTTOM];
  if (showFooter) parts.push('', footer);
  return parts.join('\n');
}

export function compactFrame(title, lines = [], { showFooter = true, footer = FOOTER } = {}) {
  const body = toLines(lines).map((line) => `▸ ${line}`);
  const parts = [`⛓ ${title}`, ...body];
  if (showFooter) parts.push('', footer);
  return parts.join('\n');
}

export function directResponse(title, body, { showFooter = true, footer = FOOTER } = {}) {
  const parts = [`🔥 ${title}`, '', String(body ?? '').trim()];
  if (showFooter) parts.push('', footer);
  return parts.join('\n');
}

export function errorResponse(message) {
  return fullFrame('☠️ CURSE REJECTED', [`🩸 ${message}`]);
}

export function successResponse(title, message) {
  return fullFrame(`👹 ${title}`, [`🩸 ${message}`]);
}

export function warningResponse(message) {
  return compactFrame('⚠️ DOMAIN WARNING', [message]);
}

export function formatCommandLine(prefix, command) {
  return `▸ ${prefix}${command.name} — ${command.description}`;
}

function menuSection(label) {
  return `┣━━〔 ${label} 〕`;
}

export function menu({
  prefix,
  version,
  categories,
  total,
  botName = BOT_NAME,
  slogan = '',
  footer = FOOTER,
}) {
  const lines = [
    `${TOP} ${String(botName).toUpperCase()} ${TOP_END}`,
    '┃',
    menuSection('⚔️ SHRINE OF THE KING'),
    `┃ ◈ VESSEL: ${botName}`,
    `┃ ◈ PREFIX: ${prefix}`,
    `┃ ◈ VERSION: ${version}`,
    `┃ ◈ COMMANDS: ${total}`,
  ];

  if (slogan) lines.push('┃', `┃ ✦ ${slogan}`);

  for (const category of categories) {
    lines.push('┃', menuSection(`✦ ${category.label.toUpperCase()}`));
    for (const command of category.commands) {
      lines.push(`┃ ⌁ ${prefix}${command.name}`);
    }
  }

  lines.push('┃', `┃ ➤ ${prefix}beg <command> reveals a single curse`, BOTTOM, '', footer);
  return lines.join('\n');
}

export function renderTemplate(template, values) {
  let output = String(template ?? '');
  for (const [key, value] of Object.entries(values)) {
    output = output.split(`{${key}}`).join(value);
  }
  return output;
}

function ensureFooter(text, footer = FOOTER) {
  return text.includes('POWERED BY') ? text : `${text.trimEnd()}\n\n${footer}`;
}

export function welcomeMessage({
  userJid,
  groupName,
  memberCount,
  rules,
  time,
  template,
  footer = FOOTER,
}) {
  const safeRules = sanitizeField(rules, 900) || 'No laws have been inscribed. The strong decide.';
  const values = {
    user: displayMention(userJid),
    group: sanitizeField(groupName, 120) || 'this domain',
    count: String(Number(memberCount) || 0),
    rules: safeRules,
    time: sanitizeField(time, 80),
  };
  return ensureFooter(renderTemplate(template, values), footer);
}

export function goodbyeMessage({
  userJid,
  groupName,
  memberCount,
  rules,
  time,
  template,
  footer = FOOTER,
}) {
  const values = {
    user: displayMention(userJid),
    group: sanitizeField(groupName, 120) || 'this domain',
    count: String(Number(memberCount) || 0),
    rules: sanitizeField(rules, 900) || 'The law does not mourn.',
    time: sanitizeField(time, 80),
  };
  return ensureFooter(renderTemplate(template, values), footer);
}

export function progressBar(current, total, width = 10) {
  const safeTotal = Math.max(1, Number(total) || 1);
  const ratio = Math.min(1, Math.max(0, Number(current) / safeTotal));
  const filled = Math.round(ratio * width);
  return `${'█'.repeat(filled)}${'░'.repeat(Math.max(0, width - filled))} ${Math.round(ratio * 100)}%`;
}

export function bulletList(items) {
  return toLines(items).map((item) => `▸ ${item}`);
}

export { FOOTER, BOT_NAME };