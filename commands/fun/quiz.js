import { runQuizCommand } from '../../lib/games/quiz.js';

export default {
  name: 'quiz',
  aliases: [],
  description: 'Answer a multiple-choice question by option number.',
  category: 'fun',
  usage: 'quiz',
  permissions: ['public'],
  cooldownMs: 3000,
  async execute(ctx) {
    await runQuizCommand(ctx, 'quiz');
  },
};
