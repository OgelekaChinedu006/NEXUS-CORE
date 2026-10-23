import { CommandError } from '../lib/helpers.js';
import { apiRegistry, getModels } from '../lib/api.js';
import { AIService, AIRequestFailure, toCommandError } from './ai.js';

// Odin: independent Groq economy tier. Uses only GROQ_API_KEY_ODIN, never
// Akasha's keys, Thoth's key, or another tier's key. Networking, timeout and
// request-body construction are inherited from AIService.
const REGISTRY_KEY = 'odin';
const KEY_ENV = 'GROQ_API_KEY_ODIN';

const ODIN_POLICY = Object.freeze({
  reasoningEffort: 'low',
  maxCompletionTokens: 400,
});

export class OdinService extends AIService {
  constructor(config, logger) {
    super(config, logger);

    // Only what AIService.requestModel/buildBody read from this.config.
    this.config = Object.freeze({
      timeoutMs: config.ai?.timeoutMs ?? 30000,
      maxTokens: ODIN_POLICY.maxCompletionTokens,
    });
    this.apiKey = config.odin?.apiKey || '';
  }

  get provider() {
    return 'groq';
  }

  // Only this service's own key is ever returned for its model slots.
  getGroqApiKey(model) {
    return model.apiKeyEnv === KEY_ENV ? this.apiKey : '';
  }

  get available() {
    return Boolean(
      apiRegistry[REGISTRY_KEY]?.enabled &&
      getModels(REGISTRY_KEY, 'text').some((model) =>
        this.getGroqApiKey(model),
      ),
    );
  }

  get unavailableReason() {
    if (!apiRegistry[REGISTRY_KEY]?.enabled) {
      return 'Odin is disabled in lib/api.js.';
    }

    if (!getModels(REGISTRY_KEY, 'text').length) {
      return 'No enabled Odin text models are registered in lib/api.js.';
    }

    if (!this.apiKey) {
      return `${KEY_ENV} is not configured.`;
    }

    return '';
  }

  async chat({
    system = '',
    prompt,
    maxTokens,
    temperature = 0.8,
  }) {
    if (!this.available) {
      throw new CommandError(
        `Odin is dormant. ${this.unavailableReason} Configure the required variables in .env.`,
      );
    }

    const messages = [];

    if (system) {
      messages.push({ role: 'system', content: system });
    }

    messages.push({
      role: 'user',
      content: String(prompt).slice(0, 8000),
    });

    const provider = apiRegistry[REGISTRY_KEY];
    let lastError;

    for (const model of getModels(REGISTRY_KEY, 'text')) {
      const apiKey = this.getGroqApiKey(model);

      if (!apiKey) {
        this.logger?.warn?.(
          `Skipping Odin model ${model.id}: assigned API key is not configured.`,
        );
        continue;
      }

      try {
        return await this.requestModel({
          baseUrl: provider.baseURL,
          apiKey,
          model: model.id,
          messages,
          maxTokens,
          temperature,
          groqPolicy: ODIN_POLICY,
        });
      } catch (error) {
        if (!(error instanceof AIRequestFailure)) {
          throw error;
        }

        lastError = error;

        // One key per service: a rejected key would fail every slot, so stop
        // on authentication and other non-retryable errors. Retry only
        // transient failures on the next slot.
        if (!error.retryable) {
          throw toCommandError(error);
        }

        this.logger?.warn?.(
          `Odin model ${model.id} failed; checking the next slot.`,
        );
      }
    }

    if (lastError) {
      throw toCommandError(lastError);
    }

    throw new CommandError(
      'No eligible Odin models have a configured API key.',
    );
  }
}
