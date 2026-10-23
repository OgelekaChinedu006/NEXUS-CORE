import { createTextIdentityCommand } from '../../lib/ai-identity.js';

export default createTextIdentityCommand({
  name: 'sage',
  description: 'Ask Sage, the quiet mind, for patience-sharpened understanding.',
  usage: 'sage <prompt>',
  serviceKey: 'sage',
  emptyPromptMessage: 'Ask Sage something.',
  missingServiceMessage: 'Sage is not bound to this vessel.',
});
