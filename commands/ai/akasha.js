import { createTextIdentityCommand } from '../../lib/ai-identity.js';

export default createTextIdentityCommand({
  name: 'akasha',
  description: 'Ask Akasha, the infinite archive of cursed intelligence.',
  usage: 'akasha <prompt>',
  serviceKey: 'ai',
  emptyPromptMessage: 'Ask Akasha something.',
  missingServiceMessage: 'Akasha is not bound to this vessel.',
});
