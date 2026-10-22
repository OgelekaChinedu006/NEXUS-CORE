import { CommandError } from '../lib/helpers.js';
import { apiRegistry, getModels } from '../lib/api.js';

// Shared Akasha policy applied to every Groq model slot.
const GROQ_POLICY = Object.freeze({
  reasoningEffort: 'medium',
  maxCompletionTokens: 1200,
});

function chatEndpoint(baseUrl) {
  if (!baseUrl) return '';

  const normalizedBaseUrl = baseUrl.replace(/\/+$/, '');

  if (normalizedBaseUrl.endsWith('/chat/completions')) {
    return normalizedBaseUrl;
  }

  return `${normalizedBaseUrl}/chat/completions`;
}

class AIRequestFailure extends Error {
  constructor(message, { retryable = false, status = 0, cause } = {}) {
    super(message, { cause });
    this.name = 'AIRequestFailure';
    this.retryable = retryable;
    this.status = status;
  }
}

function toCommandError(error) {
  if (error.status === 401 || error.status === 403) {
    return new CommandError(
      'The AI credentials were rejected. Check the configured API key.',
    );
  }

  if (error.status === 429) {
    return new CommandError(
      'The AI service is rate limiting requests. Try again later.',
    );
  }

  if (error.message === 'timeout') {
    return new CommandError('The AI service timed out before answering.');
  }

  if (error.message === 'empty-response') {
    return new CommandError(
      'The AI service returned an empty revelation.',
    );
  }

  if (error.status) {
    return new CommandError(
      `The AI service failed with HTTP ${error.status}.`,
    );
  }

  return new CommandError('The AI service could not be reached.');
}

export class AIService {
  constructor(config, logger) {
    this.config = config.ai;
    this.logger = logger;
  }

  get provider() {
    return this.config.provider || 'custom';
  }

  getGroqApiKey(model) {
    switch (model.apiKeyEnv) {
      case 'GROQ_API_KEY':
        return this.config.groqApiKey || '';

      case 'GROQ_API_KEY_2':
        return this.config.groqApiKey2 || '';

      default:
        return '';
    }
  }

  get available() {
    if (this.provider === 'groq') {
      const models = getModels('groq', 'text');

      return Boolean(
        apiRegistry.groq?.enabled &&
        models.some((model) => this.getGroqApiKey(model)),
      );
    }

    return Boolean(
      this.config.baseUrl &&
      this.config.apiKey &&
      this.config.model,
    );
  }

  get unavailableReason() {
    if (this.provider === 'groq') {
      if (!apiRegistry.groq?.enabled) {
        return 'Groq is disabled in lib/api.js.';
      }

      if (!getModels('groq', 'text').length) {
        return 'No enabled Groq text models are registered in lib/api.js.';
      }

      if (
        !this.config.groqApiKey &&
        !this.config.groqApiKey2
      ) {
        return 'Neither GROQ_API_KEY nor GROQ_API_KEY_2 is configured.';
      }

      return '';
    }

    if (!this.config.baseUrl) {
      return 'AI_BASE_URL is not configured.';
    }

    if (!this.config.apiKey) {
      return 'AI_API_KEY is not configured.';
    }

    if (!this.config.model) {
      return 'AI_MODEL is not configured.';
    }

    return '';
  }

  // Builds the request body. Groq slots follow GROQ_POLICY
  // (max_completion_tokens + reasoning_effort); custom providers keep
  // the legacy max_tokens behaviour with the original 4000 ceiling.
  buildBody({ model, messages, maxTokens, temperature, groqPolicy }) {
    const requested = maxTokens || this.config.maxTokens;

    if (groqPolicy) {
      return {
        model,
        messages,
        max_completion_tokens: Math.min(
          requested,
          groqPolicy.maxCompletionTokens,
        ),
        reasoning_effort: groqPolicy.reasoningEffort,
        temperature,
      };
    }

    return {
      model,
      messages,
      max_tokens: Math.min(requested, 4000),
      temperature,
    };
  }

  async requestModel({
    baseUrl,
    apiKey,
    model,
    messages,
    maxTokens,
    temperature,
    groqPolicy = null,
  }) {
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      this.config.timeoutMs,
    );

    try {
      let response;

      try {
        response = await fetch(chatEndpoint(baseUrl), {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify(
            this.buildBody({
              model,
              messages,
              maxTokens,
              temperature,
              groqPolicy,
            }),
          ),
          signal: controller.signal,
        });
      } catch (error) {
        if (error?.name === 'AbortError') {
          throw new AIRequestFailure('timeout', {
            retryable: true,
            cause: error,
          });
        }

        throw new AIRequestFailure('network-error', {
          retryable: true,
          cause: error,
        });
      }

      if (response.status === 401 || response.status === 403) {
        throw new AIRequestFailure('authentication-error', {
          status: response.status,
        });
      }

      const retryableStatus =
        response.status === 408 ||
        response.status === 409 ||
        response.status === 425 ||
        response.status === 429 ||
        response.status >= 500;

      if (!response.ok) {
        throw new AIRequestFailure('http-error', {
          status: response.status,
          retryable: retryableStatus,
        });
      }

      let data;

      try {
        data = await response.json();
      } catch (error) {
        throw new AIRequestFailure('invalid-response', {
          retryable: true,
          cause: error,
        });
      }

      const content = data?.choices?.[0]?.message?.content;

      if (typeof content !== 'string' || !content.trim()) {
        throw new AIRequestFailure('empty-response', {
          retryable: true,
        });
      }

      return content.trim();
    } finally {
      clearTimeout(timer);
    }
  }

  async chat({
    system = '',
    prompt,
    maxTokens,
    temperature = 0.8,
  }) {
    if (!this.available) {
      throw new CommandError(
        `Cursed intelligence is dormant. ${this.unavailableReason} Configure the required variables in .env.`,
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

    if (this.provider === 'groq') {
      const provider = apiRegistry.groq;
      const models = getModels('groq', 'text');
      let lastError;
      // Keys rejected with HTTP 401/403 during this request. A rejected
      // key is never retried on its remaining model slots.
      const rejectedKeys = new Set();

      for (const model of models) {
        const apiKey = this.getGroqApiKey(model);

        // Never use another account's key for this model slot.
        if (!apiKey) {
          this.logger?.warn?.(
            `Skipping Groq model ${model.id}: assigned API key is not configured.`,
          );
          continue;
        }

        if (rejectedKeys.has(apiKey)) {
          this.logger?.warn?.(
            `Skipping Groq model ${model.id}: its assigned API key was already rejected.`,
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
            groqPolicy: GROQ_POLICY,
          });
        } catch (error) {
          if (!(error instanceof AIRequestFailure)) {
            throw error;
          }

          lastError = error;

          // Authentication/permission failure: this key is rejected, so
          // skip its remaining slots and continue with the other
          // account's slots.
          if (error.status === 401 || error.status === 403) {
            rejectedKeys.add(apiKey);
            this.logger?.warn?.(
              `Groq model ${model.id} was rejected for authentication; skipping remaining slots that use the same key.`,
            );
            continue;
          }

          // Stop immediately for other non-retryable errors. Retry
          // transient failures on the next eligible slot.
          if (!error.retryable) {
            throw toCommandError(error);
          }

          this.logger?.warn?.(
            `Groq model ${model.id} failed; checking the next eligible slot.`,
          );
        }
      }

      if (lastError) {
        throw toCommandError(lastError);
      }

      throw new CommandError(
        'No eligible Groq models have a configured API key.',
      );
    }

    try {
      return await this.requestModel({
        baseUrl: this.config.baseUrl,
        apiKey: this.config.apiKey,
        model: this.config.model,
        messages,
        maxTokens,
        temperature,
      });
    } catch (error) {
      if (error instanceof AIRequestFailure) {
        throw toCommandError(error);
      }

      throw error;
    }
  }
}