import { CommandError } from '../../lib/helpers.js';
import {
  describeWordChainStart,
  describeWordChainStatus,
  joinWordChain,
  parseWord,
  processWord,
  startWordChain,
} from '../../lib/games/wordchain.js';

export default {
  name: 'wordchain',
  aliases: ['wc'],
  description: 'Play a multiplayer word-chain game in the chat.',
  category: 'fun',
  usage: 'wordchain [join|word]',
  permissions: ['public'],
  cooldownMs: 1000,
  async execute(ctx) {
    if (!ctx.games) throw new CommandError('The game engine is not available.');
    const session = ctx.games.get(ctx.chatJid);

    if (session && session.type === 'wordchain') {
      if (ctx.args.length === 0) {
        await ctx.reply(describeWordChainStatus(session));
        return;
      }

      if (ctx.args[0].trim().toLowerCase() === 'join') {
        const outcome = joinWordChain(session, ctx.senderJid, { groupMeta: ctx.groupMeta });
        if (!outcome) {
          throw new CommandError('You are already in this word-chain game.');
        }
        await ctx.reply(outcome.text, { mentions: outcome.mentions });
        return;
      }

      const word = parseWord(ctx.args[0]);
      if (word === null) {
        throw new CommandError('Reply with a single 3–32 letter word, or join to enter the game.');
      }

      const outcome = processWord(session, word, ctx.senderJid, { groupMeta: ctx.groupMeta });
      if (!outcome) {
        throw new CommandError('Only players in the chain may play. Join first or start your own game.');
      }
      await ctx.reply(outcome.text, outcome.mentions.length ? { mentions: outcome.mentions } : {});
      return;
    }

    const extras = [ctx.targetJid, ...(ctx.targetJids || [])].filter(Boolean);
    const started = startWordChain(ctx.games, ctx.chatJid, {
      starterJid: ctx.senderJid,
      playerJids: extras,
      socket: ctx.sock || null,
      groupMeta: ctx.groupMeta || null,
    });
    await ctx.reply(describeWordChainStart(started), {
      mentions: started.data.players.map((player) => player.jid),
    });
  },
};
