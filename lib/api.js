
const groqModels = [
  {
    id: 'openai/gpt-oss-120b',
    enabled: true,
    priority: 1,
    account: 1,
    apiKeyEnv: 'GROQ_API_KEY',
    capabilities: ['text', 'reasoning'],
  },
  {
    id: 'openai/gpt-oss-20b',
    enabled: true,
    priority: 2,
    account: 1,
    apiKeyEnv: 'GROQ_API_KEY',
    capabilities: ['text', 'reasoning'],
  },
  {
    id: 'qwen/qwen3.8-27b',
    enabled: true,
    priority: 3,
    account: 1,
    apiKeyEnv: 'GROQ_API_KEY',
    capabilities: ['text', 'reasoning'],
  },
  {
    id: 'openai/gpt-oss-120b',
    enabled: true,
    priority: 4,
    account: 2,
    apiKeyEnv: 'GROQ_API_KEY_2',
    capabilities: ['text', 'reasoning'],
  },
  {
    id: 'openai/gpt-oss-20b',
    enabled: true,
    priority: 5,
    account: 2,
    apiKeyEnv: 'GROQ_API_KEY_2',
    capabilities: ['text', 'reasoning'],
  },
  {
    id: 'qwen/qwen3.8-27b',
    enabled: true,
    priority: 6,
    account: 2,
    apiKeyEnv: 'GROQ_API_KEY_2',
    capabilities: ['text', 'reasoning'],
  },
];

// Odin and Omen: independent three-slot Groq economy tiers. Each tier owns
// exactly one API key (its own apiKeyEnv) and never uses Akasha's keys.
function economyModels(apiKeyEnv) {
  return [
    'openai/gpt-oss-120b',
    'openai/gpt-oss-20b',
    'qwen/qwen3.8-27b',
  ].map((id, index) => ({
    id,
    enabled: true,
    priority: index + 1,
    apiKeyEnv,
    capabilities: ['text', 'reasoning'],
  }));
}

export const apiRegistry = {
  groq: {
    enabled: true,
    baseURL: 'https://api.groq.com/openai/v1',
    models: groqModels,
  },
  odin: {
    enabled: true,
    baseURL: 'https://api.groq.com/openai/v1',
    models: economyModels('GROQ_API_KEY_ODIN'),
  },
  omen: {
    enabled: true,
    baseURL: 'https://api.groq.com/openai/v1',
    models: economyModels('GROQ_API_KEY_OMEN'),
  },
};

export function getModels(provider, capability = 'text') {
  return (apiRegistry[provider]?.models ?? [])
    .filter(
      (model) =>
        model.enabled && model.capabilities.includes(capability),
    )
    .sort((a, b) => a.priority - b.priority);
}
