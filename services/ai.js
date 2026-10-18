import { CommandError } from '../lib/helpers.js';

function chatEndpoint(baseUrl) {
  if (!baseUrl) return '';
  if (baseUrl.endsWith('/chat/completions')) return baseUrl;
  return `${baseUrl}/chat/completions`;
}

export class AIService {
  constructor(config, logger) {
    this.config = config.ai;
    this.logger = logger;
  }

  get available() {
    return Boolean(this.config.baseUrl && this.config.apiKey && this.config.model);
  }

  get unavailableReason() {
    if (!this.config.baseUrl) return 'AI_BASE_URL is not configured.';
    if (!this.config.apiKey) return 'AI_API_KEY is not configured.';
    if (!this.config.model) return 'AI_MODEL is not configured.';
    return '';
  }

  async chat({ system = '', prompt, maxTokens, temperature = 0.8 }) {
    if (!this.available) {
      throw new CommandError(
        `Cursed intelligence is dormant. ${this.unavailableReason} Configure the AI_* variables in .env.`,
      );
    }

    const messages = [];
    if (system) messages.push({ role: 'system', content: system });
    messages.push({ role: 'user', content: String(prompt).slice(0, 8000) });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);
    try {
      const response = await fetch(chatEndpoint(this.config.baseUrl), {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify({
          model: this.config.model,
          messages,
          max_tokens: Math.min(maxTokens || this.config.maxTokens, 4000),
          temperature,
        }),
        signal: controller.signal,
      });

      if (response.status === 401 || response.status === 403) {
        throw new CommandError('The AI credentials were rejected. Check AI_API_KEY.');
      }
      if (response.status === 429) {
        throw new CommandError('The AI service is rate limiting requests. Try again later.');
      }
      if (!response.ok) {
        throw new CommandError(`The AI service failed with HTTP ${response.status}.`);
      }

      const data = await response.json();
      const content = data?.choices?.[0]?.message?.content;
      if (typeof content !== 'string' || !content.trim()) {
        throw new CommandError('The AI service returned an empty revelation.');
      }
      return content.trim();
    } catch (error) {
      if (error instanceof CommandError) throw error;
      if (error?.name === 'AbortError') {
        throw new CommandError('The AI service timed out before answering.');
      }
      throw new CommandError('The AI service could not be reached.');
    } finally {
      clearTimeout(timer);
    }
  }
}
