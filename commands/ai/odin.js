import { createTextIdentityCommand } from '../../lib/ai-identity.js';

export default createTextIdentityCommand({
  name: 'odin',
  description: 'Ask Odin, the Allfather, to speak with weaponized wisdom.',
  usage: 'odin <prompt>',
  serviceKey: 'odin',
  emptyPromptMessage: 'Ask Odin something.',
  missingServiceMessage: 'Odin is not bound to this vessel.',
});
