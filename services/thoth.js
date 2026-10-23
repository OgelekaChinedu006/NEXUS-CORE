
import Cerebras from '@cerebras/cerebras_cloud_sdk';
import { CommandError } from '../lib/helpers.js';

const MODELS = [
    { id: 'qwen-3.8-27b', reasoningEffort: 'none' },
    { id: 'gpt-oss-120b', reasoningEffort: 'low' },
  ];
const DEFAULT_MAX_TOKENS = 400;
const MAX_TOKENS = 400;

export class ThothService {
  constructor(config, logger, client = null) {
    this.config = config.ai;
    this.logger = logger;

    this.client =
      client ||
      (this.config.cerebrasApiKey
        ? new Cerebras({
            apiKey: this.config.cerebrasApiKey,
            timeout: this.config.timeoutMs,
            maxRetries: 0,
          })
        : null);
  }

  get available() {
    return Boolean(this.config.cerebrasApiKey && this.client);
  }

  get unavailableReason() {
    return this.config.cerebrasApiKey
      ? 'The Cerebras client is unavailable.'
      : 'CEREBRAS_API_KEY is not configured.';
  }

  async chat({
    system = '',
    prompt,
    maxTokens = DEFAULT_MAX_TOKENS,
    temperature = 0.2,
  }) {
    if (!this.available) {
      throw new CommandError(
        `Thoth is dormant. ${this.unavailableReason} Configure it in .env.`,
      );
    }

    const messages = [];

    if (system) {
      messages.push({
        role: 'system',
        content: String(system).slice(0, 3000),
      });
    }

    messages.push({
      role: 'user',
      content: String(prompt).slice(0, 8000),
    });

    let lastError;

    for (const { id: model, reasoningEffort } of MODELS) {
      try {
        const completion =
          await this.client.chat.completions.create({
            model,
            messages,
            max_completion_tokens: Math.min(
              Math.max(1, Number(maxTokens) || DEFAULT_MAX_TOKENS),
              MAX_TOKENS,
            ),
            temperature,
            top_p: 1,
            reasoning_effort: reasoningEffort,
            stream: false,
          });

        const content = completion?.choices?.[0]?.message?.content;

        if (typeof content !== 'string' || !content.trim()) {
          throw new Error('The model returned an empty response.');
        }

        return content.trim();
      } catch (error) {
        lastError = error;

        const status = error?.status ?? error?.statusCode;

        if (status === 401 || status === 403) {
          throw new CommandError(
            'Thoth credentials were rejected. Check CEREBRAS_API_KEY.',
          );
        }

        this.logger?.warn?.(
          `Thoth model ${model} failed${status ? ` (HTTP ${status})` : ''}; trying fallback if available.`,
        );
      }
    }

    const status = lastError?.status ?? lastError?.statusCode;

    if (status === 429) {
      throw new CommandError(
        'Cerebras is rate limiting requests. Try again later.',
      );
    }

    if (lastError?.name === 'APIConnectionTimeoutError') {
      throw new CommandError('Thoth timed out before answering.');
    }

    throw new CommandError(
      'Thoth could not get a valid response from either Cerebras model.',
    );
  }
}
