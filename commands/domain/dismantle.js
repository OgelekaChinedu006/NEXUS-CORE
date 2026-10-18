import { fullFrame } from '../../lib/formatter.js';
import { apiFailure } from '../../lib/command-utils.js';
import { normalizeJid } from '../../lib/helpers.js';
import { isGroupCreator } from '../../lib/permissions.js';

export default {
  name: 'dismantle',
  aliases: ['stripadmins'],
  description: 'Dismantle the admin structure, sparing the founder and the vessel.',
  category: 'domain',
  usage: 'dismantle',
  permissions: ['admin', 'botAdmin'],
  async execute(ctx) {
    const participants = ctx.groupMeta?.participants || [];
    const protectedJids = new Set(
      [ctx.botJid, ctx.config.ownerJid, ctx.senderJid, ctx.groupMeta?.owner]
        .filter(Boolean)
        .map((jid) => normalizeJid(jid)),
    );

    const targets = participants
      .filter((participant) => participant.admin)
      .filter((participant) => {
        const jid = normalizeJid(participant.id);
        return jid && !protectedJids.has(jid) && !isGroupCreator(ctx.groupMeta, jid);
      })
      .map((participant) => normalizeJid(participant.id));

    if (targets.length === 0) {
      await ctx.reply(fullFrame('☠️ NOTHING TO DISMANTLE', ['No unprotected administrators remain.']));
      return;
    }

    try {
      await ctx.sock.groupParticipantsUpdate(ctx.chatJid, targets, 'demote');
    } catch (error) {
      throw apiFailure('dismantle', error);
    }
    ctx.db.logModeration(ctx.chatJid, 'dismantle', null, ctx.senderJid, `Demoted ${targets.length} admins`);
    await ctx.reply(
      fullFrame('🏯 DOMAIN DISMANTLED', [
        `🩸 ADMINISTRATORS STRIPPED: ${targets.length}`,
        '⛓ The founder, the vessel and the acting authority were spared.',
      ]),
    );
  },
};
