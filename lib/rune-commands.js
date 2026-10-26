import { fullFrame } from './formatter.js';
import { CommandError, normalizeJid, toUserJid } from './helpers.js';
import { identityJids } from './identity.js';
import {
  BOT_RUNE_MODE_SET,
  CALL_RUNE_MODE_SET,
  GLOBAL_RUNE_SCOPE,
  RUNE_MODE_SET,
  describeRuneSetting,
  resolveRuneSetting,
} from './runes.js';

const TOGGLE_ON = new Set(['on', 'true', '1', 'enable', 'enabled']);
const TOGGLE_OFF = new Set(['off', 'false', '0', 'disable', 'disabled']);

function titleFor(rune) {
  return `${String(rune).toUpperCase()} RUNE`;
}

function resolveScope(ctx, rune) {
  if (rune === 'call') return GLOBAL_RUNE_SCOPE;
  if (rune === 'mention' && !ctx.isGroup && (ctx.isOwner || ctx.isSudo)) return GLOBAL_RUNE_SCOPE;
  return ctx.chatJid;
}

function allowedModes(rune) {
  if (rune === 'bot') return [...BOT_RUNE_MODE_SET];
  if (rune === 'call') return [...CALL_RUNE_MODE_SET];
  return [...RUNE_MODE_SET];
}

function parseMode(rune, value) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return null;
  if (rune === 'bot') {
    if (raw === 'crushzone' || raw === 'crush-zone' || raw === 'crush_zone') return 'crush';
    return BOT_RUNE_MODE_SET.has(raw) ? raw : null;
  }
  if (rune === 'call') return CALL_RUNE_MODE_SET.has(raw) ? raw : null;
  return RUNE_MODE_SET.has(raw) ? raw : null;
}

function helpLines(ctx, rune) {
  const prefix = ctx.prefix || '!';
  const modes = allowedModes(rune).join('|');
  const lines = [
    `${prefix}${rune}rune [on|off]`,
    `${prefix}${rune}rune ${modes}`,
    `${prefix}${rune}rune status`,
    `${prefix}${rune}rune help`,
  ];
  if (rune !== 'bot') {
    lines.splice(2, 0, `${prefix}${rune}rune reset @user`);
  }
  if (rune === 'link' || rune === 'mention' || rune === 'spam') {
    lines.splice(2, 0, `${prefix}${rune}rune punish kick`);
  }
  if (rune === 'link') {
    lines.push('Mercy deletes the link and warns once. Later violations are still deleted, never punished.');
    lines.push('Grace warns on violations 1, 2 and 3. The configured punishment falls on violation 4.');
    lines.push('Exile deletes the link and applies the configured punishment immediately.');
  }
  if (rune === 'spam') {
    lines.push(`${prefix}spamrune flood <count> [window]`);
    lines.push(`${prefix}spamrune text <count> [window]`);
    lines.push(`${prefix}spamrune media <count> [window]`);
    lines.push('Mercy deletes the spam and warns once. Later violations are still deleted, never punished.');
    lines.push('Grace warns on violations 1, 2 and 3. The configured punishment falls on violation 4.');
    lines.push('Exile deletes the spam and applies the configured punishment immediately.');
    lines.push('Flood counts distinct incoming messages. Defaults: 15 in 5s.');
    lines.push('Repeated text is case and whitespace normalized. The first copy is kept. Defaults: 3 in 10s.');
    lines.push('Repeated media matches file hash or media key plus path, never MIME type alone, and never downloads files. Defaults: 3 in 10s.');
    lines.push('One burst is one violation even if flood and repeats match together.');
  }
  if (rune === 'call') {
    lines.push('Mercy never blocks. Grace blocks on the fourth call. Exile blocks immediately.');
    lines.push('Private offer calls only. Group calls are ignored.');
  }
  if (rune === 'mention') {
    lines.push('Genuine WhatsApp group mentions of a protected group only.');
    lines.push('Individual @mentions and ordinary text that contains a group name are ignored.');
    lines.push('Invite links are handled by Link Rune, not Mention Rune.');
    lines.push('WhatsApp does not permit deleting another person\'s Status.');
  }
  if (rune === 'bot') {
    lines.push('Lockdown never removes members.');
    lines.push('Crush Zone removes only when conservative criteria match.');
    lines.push('Independent from !lockdown / !liberate / !silence / !release.');
  }
  return lines;
}

function statusLines(ctx, rune, setting) {
  const scope = setting.scope;
  const count = rune === 'bot'
    ? null
    : ctx.targetJid
      ? ctx.db.runes.getViolationCount(scope, ctx.targetJid, rune)
      : null;
  const lines = [
    `🩸 STATUS: ${describeRuneSetting(setting)}`,
    `⛓ SCOPE: ${scope}`,
    `👁 MODE: ${String(setting.mode).toUpperCase()}`,
    setting.source === 'legacy' ? '⚠ SOURCE: legacy ward (dual-read until a Rune is configured)' : `⚠ SOURCE: ${setting.source}`,
  ];
  if (rune === 'link' || rune === 'mention' || rune === 'spam') {
    lines.push(`☠️ PUNISHMENT: ${String(setting.punishment).toUpperCase()}`);
  }
  if (rune === 'spam' && setting.spamLimits) {
    const limits = setting.spamLimits;
    lines.push(`👁 FLOOD: ${limits.floodCount} / ${limits.floodWindowMs}ms`);
    lines.push(`👁 TEXT: ${limits.repeatTextCount} / ${limits.repeatTextWindowMs}ms`);
    lines.push(`👁 MEDIA: ${limits.repeatMediaCount} / ${limits.repeatMediaWindowMs}ms`);
  }
  if (rune === 'call') {
    lines.push('Mercy never blocks. Grace blocks on the fourth qualifying call. Exile blocks on the first.');
  }
  if (count != null) {
    lines.push(`👁 MARKS FOR TARGET: ${count}`);
  }
  return lines;
}

function requireConfigurePermission(ctx, rune) {
  if (rune === 'call') {
    if (!ctx.isOwner && !ctx.isSudo) {
      throw new CommandError('Only the Sovereign or a bound operator may configure Call Rune.');
    }
    return;
  }
  if (!ctx.isGroup) {
    if (rune === 'mention' && (ctx.isOwner || ctx.isSudo)) return;
    throw new CommandError('This Rune is configured inside a group.');
  }
  if (!ctx.isOwner && !ctx.isSudo && !ctx.isAdmin) {
    throw new CommandError('Only group admins may configure this Rune.');
  }
}

export async function executeRuneCommand(ctx, rune) {
  requireConfigurePermission(ctx, rune);
  const scope = resolveScope(ctx, rune);
  const args = ctx.args.map((arg) => String(arg).toLowerCase());
  const action = args[0] || 'status';

  if (action === 'help') {
    await ctx.reply(fullFrame(`🧿 ${titleFor(rune)}`, helpLines(ctx, rune)));
    return;
  }

  if (action === 'reset') {
    if (rune === 'bot') throw new CommandError('Bot Rune has no violation counter to reset.');
    const target = normalizeJid(ctx.targetJid || toUserJid(ctx.args[1]));
    if (!target) {
      throw new CommandError('Mention a soul to clear this Rune only. Unscoped reset is refused.');
    }
    const ids = identityJids(ctx.groupMeta, target);
    const unique = ids.length ? ids : [target];
    let changes = 0;
    for (const id of unique) {
      changes += ctx.db.runes.resetViolation(scope, id, rune);
      ctx.db.runes.releaseEvent?.(`mercy:${scope}:${id}`, rune);
    }
    ctx.db.logAudit?.(ctx.senderJid, `${rune}-rune-reset`, target, scope);
    await ctx.reply(
      fullFrame(`🧿 ${titleFor(rune)}`, [
        `🩸 SOUL: @${target.split('@')[0]}`,
        `⛓ MARKS CLEARED: ${changes ? 'YES' : 'NONE WERE STORED'}`,
        'Only this Rune, this soul, and this scope were touched.',
      ]),
      { mentions: [target] },
    );
    return;
  }

  const patch = {};
  let recognized = action === 'status';
  const tokens = action === 'status' ? args.slice(1) : args;

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (TOGGLE_ON.has(token)) {
      patch.enabled = true;
      recognized = true;
      continue;
    }
    if (TOGGLE_OFF.has(token)) {
      patch.enabled = false;
      recognized = true;
      continue;
    }
    const mode = parseMode(rune, token);
    if (mode) {
      patch.mode = mode;
      if (patch.enabled === undefined) patch.enabled = true;
      recognized = true;
      continue;
    }
    if (token === 'punish' || token === 'punishment') {
      const next = String(tokens[index + 1] || '').toLowerCase();
      if (next !== 'kick') throw new CommandError('Supported punishment: kick.');
      patch.punishment = 'kick';
      recognized = true;
      index += 1;
      continue;
    }
    if (rune === 'spam' && (token === 'flood' || token === 'text' || token === 'media')) {
      const countRaw = tokens[index + 1];
      const windowRaw = tokens[index + 2];
      const count = Number.parseInt(countRaw, 10);
      if (!Number.isFinite(count)) {
        throw new CommandError(`Provide a ${token} count. Use ${ctx.prefix}spamrune help.`);
      }
      if (token === 'flood') patch.spamFloodCount = count;
      if (token === 'text') patch.spamRepeatTextCount = count;
      if (token === 'media') patch.spamRepeatMediaCount = count;
      recognized = true;
      index += 1;
      const windowMs = Number.parseInt(windowRaw, 10);
      if (Number.isFinite(windowMs)) {
        if (token === 'flood') patch.spamFloodWindowMs = windowMs;
        if (token === 'text') patch.spamRepeatTextWindowMs = windowMs;
        if (token === 'media') patch.spamRepeatMediaWindowMs = windowMs;
        index += 1;
      }
      continue;
    }
    throw new CommandError(`Unknown ${rune} rune argument "${token}". Use ${ctx.prefix}${rune}rune help.`);
  }

  if (!recognized) {
    throw new CommandError(`Use ${ctx.prefix}${rune}rune help.`);
  }

  const hasPatch = Object.keys(patch).length > 0;
  if (hasPatch) {
    ctx.db.runes.setSetting(scope, rune, patch);
    ctx.db.logModeration?.(
      ctx.isGroup ? ctx.chatJid : scope,
      `${rune}-rune-config`,
      null,
      ctx.senderJid,
      JSON.stringify(patch),
    );
  }

  const setting = resolveRuneSetting(ctx.db, scope, rune);
  await ctx.reply(fullFrame(`🧿 ${titleFor(rune)}`, [
    ...statusLines(ctx, rune, setting),
    '',
    `> ${ctx.prefix}${rune}rune help`,
  ]));
  return { patched: hasPatch, patch, setting };
}

export { helpLines, parseMode, resolveScope };
