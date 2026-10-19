import { runQuizCommand } from '../../lib/games/quiz.js';

export default {
  name: 'riddle',
  aliases: [],
  description: 'Solve a random riddle before time runs out.',
  category: 'fun',
  usage: 'riddle',
  permissions: ['public'],
  cooldownMs: 3000,
  async execute(ctx) {
    await runQuizCommand(ctx, 'riddle');
  },
};
