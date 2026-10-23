import { createTextIdentityCommand } from '../../lib/ai-identity.js';

export default createTextIdentityCommand({
  name: 'omen',
  description: 'Ask Omen, the voice beyond the veil, to read a mystery.',
  usage: 'omen <prompt>',
  serviceKey: 'omen',
  emptyPromptMessage: 'Ask Omen something.',
  missingServiceMessage: 'Omen is not bound to this vessel.',
});
