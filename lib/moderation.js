import { fullFrame } from './formatter.js';
import { displayMention, normalizeJid } from './helpers.js';
import { isBotAdmin } from './permissions.js';

export async function removeParticipant({ sock, groupJid, targetJid }) {
  const result = await sock.groupParticipantsUpdate(groupJid, [targetJid], 'remove');
  return result;
}

export async function warnUser({
  db,
  sock,
  logger,
  group,
  groupMeta,
  groupJid,
  targetJid,
  actorJid,
  reason,
  botJid,
  notify = true,
  autoKick = true,
}) {
  const target = normalizeJid(targetJid);
  const count = db.addWarning(groupJid, target, reason, actorJid);
  const maxWarnings = Number(group?.max_warnings) || 3;
  db.logModeration(groupJid, 'warn', target, actorJid, reason);

  let kicked = false;
  if (autoKick && count >= maxWarnings && isBotAdmin(groupMeta, botJid)) {
    try {
      await removeParticipant({ sock, groupJid, targetJid: target });
      kicked = true;
      db.logModeration(groupJid, 'auto-kick', target, botJid, `Reached ${maxWarnings} warnings`);
      db.clearWarnings(groupJid, target);
    } catch (error) {
      logger.warn(`Auto-kick failed: ${error.message}`);
    }
  }

  if (notify) {
    const lines = [
      `🩸 SOUL: ${displayMention(target)}`,
      `⛓ OFFENSE: ${reason}`,
      `👁 WARNINGS: ${Math.min(count, maxWarnings)}/${maxWarnings}`,
    ];
    if (kicked) {
      lines.push('☠️ VERDICT: BANISHED FROM THE DOMAIN');
    } else if (count >= maxWarnings && !isBotAdmin(groupMeta, botJid)) {
      lines.push('⚠️ VERDICT: THRESHOLD REACHED, BUT THE VESSEL LACKS ADMIN POWER');
    } else {
      lines.push(`⚡ VERDICT: ${maxWarnings - count} warning(s) remain before banishment.`);
    }
    try {
      await sock.sendMessage(
        groupJid,
        { text: fullFrame('☠️ JUDGMENT', lines), mentions: [target] },
      );
    } catch (error) {
      logger.warn(`Warning notice failed: ${error.message}`);
    }
  }

  return { count, kicked, maxWarnings };
}
