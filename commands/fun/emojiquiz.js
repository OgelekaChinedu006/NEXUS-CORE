import { runQuizCommand } from '../../lib/games/quiz.js';

export default {
  name: 'emojiquiz',
  aliases: [],
  description: 'Guess the movie or title from emojis.',
  category: 'fun',
  usage: 'emojiquiz',
  permissions: ['public'],
  cooldownMs: 3000,
  async execute(ctx) {
    await runQuizCommand(ctx, 'emojiquiz');
  },
};
