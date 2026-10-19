import { runQuizCommand } from '../../lib/games/quiz.js';

export default {
  name: 'trivia',
  aliases: [],
  description: 'Answer a random trivia question before time runs out.',
  category: 'fun',
  usage: 'trivia',
  permissions: ['public'],
  cooldownMs: 3000,
  async execute(ctx) {
    await runQuizCommand(ctx, 'trivia');
  },
};
