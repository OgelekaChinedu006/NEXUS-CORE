import { createTextIdentityCommand } from '../../lib/ai-identity.js';

export default createTextIdentityCommand({
  name: 'thoth',
  description: 'Ask Thoth, keeper of wisdom, to answer from the scroll.',
  usage: 'thoth <prompt>',
  serviceKey: 'thoth',
  emptyPromptMessage: 'Ask Thoth something.',
  missingServiceMessage: 'Thoth is not bound to this vessel.',
});
