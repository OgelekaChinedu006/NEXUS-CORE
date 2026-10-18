import { fullFrame } from '../../lib/formatter.js';
import { findParticipant } from '../../lib/command-utils.js';
import { CommandError, normalizeJid, toUserJid } from '../../lib/helpers.js';

function resolveAlly(ctx) {
  const target = normalizeJid(ctx.targetJid || toUserJid(ctx.args[1]));
  if (!target) throw new CommandError('Mention a member, reply to them, or pass their WhatsApp JID.');
  if (target === normalizeJid(ctx.botJid)) throw new CommandError('The vessel cannot ally with itself.');
  if (target === normalizeJid(ctx.config.ownerJid)) {
    throw new CommandError('The Sovereign needs no alliance.');
  }
  if (!findParticipant(ctx.groupMeta, target)) {
    throw new CommandError('That soul is not present in this domain.');
  }
  return target;
}

export default {
  name: 'alliance',
  aliases: ['allies'],
  description: 'Grant a trusted soul immunity from the domain wards.',
  category: 'sovereign',
  usage: 'alliance <list|add|remove> [@user]',
  permissions: ['group', 'admin'],
  cooldownMs: 2000,
  async execute(ctx) {
    const action = (ctx.args[0] || 'list').toLowerCase();

    if (action === 'list') {
      const allies = ctx.db.listAllies(ctx.chatJid);
      if (!allies.length) {
        await ctx.reply(fullFrame('🤝 ALLIANCES', ['No souls are shielded by alliance.']));
        return;
      }
      await ctx.reply(
        fullFrame('🤝 ALLIANCES', [
          ...allies.map((ally) => `▸ @${ally.user_jid.split('@')[0]}`),
          '',
          'Allies bypass the domain wards but remain below the throne.',
        ]),
        { mentions: allies.map((ally) => ally.user_jid) },
      );
      return;
    }

    if (action !== 'add' && action !== 'remove') {
      throw new CommandError('Use list, add <@user> or remove <@user>.');
    }

    const target = resolveAlly(ctx);
    if (action === 'add') {
      if (ctx.db.isAlly(ctx.chatJid, target)) {
        await ctx.reply(fullFrame('🤝 ALLIANCES', ['That soul is already an ally.']));
        return;
      }
      ctx.db.addAlly(ctx.chatJid, target, ctx.senderJid);
      ctx.db.logModeration(ctx.chatJid, 'alliance-add', target, ctx.senderJid, 'Alliance granted');
      await ctx.reply(
        fullFrame('🤝 ALLIANCE FORGED', [
          `🩸 SOUL: @${target.split('@')[0]}`,
          '⛓ The wards will overlook their conduct.',
        ]),
        { mentions: [target] },
      );
      return;
    }

    if (!ctx.db.isAlly(ctx.chatJid, target)) {
      await ctx.reply(fullFrame('🤝 ALLIANCES', ['That soul holds no alliance.']));
      return;
    }
    ctx.db.removeAlly(ctx.chatJid, target);
    ctx.db.logModeration(ctx.chatJid, 'alliance-remove', target, ctx.senderJid, 'Alliance revoked');
    await ctx.reply(
      fullFrame('🤝 ALLIANCE BROKEN', [
        `🩸 SOUL: @${target.split('@')[0]}`,
        'The wards now see them clearly.',
      ]),
      { mentions: [target] },
    );
  },
};
