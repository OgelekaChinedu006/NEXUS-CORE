import { CommandError } from '../lib/helpers.js';
import { SAGE_BASE_URL, SAGE_ENDPOINTS } from './sage-endpoints.js';

const DEFAULT_TIMEOUT_MS = 30000;
const MAX_PROMPT_LENGTH = 8000;

function normalizeTimeout(value) {
  const timeoutMs = Number(value);
  return Number.isFinite(timeoutMs) && timeoutMs > 0
    ? timeoutMs
    : DEFAULT_TIMEOUT_MS;
}

function isSuccessfulStatus(status) {
  if (status === undefined || status === null) {
    return true;
  }

  if (status === true || status === 200) {
    return true;
  }

  if (typeof status === 'string') {
    const normalized = status.trim().toLowerCase();
    return (
      normalized === 'success' ||
      normalized === 'ok' ||
      normalized === 'true' ||
      normalized === '200'
    );
  }

  return false;
}

function extractAnswer(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('malformed-payload');
  }

  if (!isSuccessfulStatus(payload.status)) {
    throw new Error('unsuccessful-status');
  }

  if (typeof payload.response !== 'string' || !payload.response.trim()) {
    throw new Error('empty-response');
  }

  return payload.response.trim();
}

export class SageService {
  constructor(config, logger) {
    this.timeoutMs = normalizeTimeout(config?.ai?.timeoutMs);
    this.logger = logger;
  }

  async chat({ prompt } = {}) {
    if (typeof prompt !== 'string' || !prompt.trim()) {
      throw new CommandError('Sage requires a prompt.');
    }

    const text = prompt.trim().slice(0, MAX_PROMPT_LENGTH);

    for (const endpoint of SAGE_ENDPOINTS) {
      try {
        return await this.requestEndpoint(endpoint, text);
      } catch {
        this.logger?.warn?.('Sage endpoint failed; trying the next one.');
      }
    }

    throw new CommandError(
      'Sage could not get a valid response from any available model.',
    );
  }

  async requestEndpoint(endpoint, prompt) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      let response;

      try {
        response = await fetch(`${SAGE_BASE_URL}${endpoint.path}`, {
          method: 'POST',
          headers: {
            accept: 'application/json',
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            [endpoint.field]: prompt,
          }),
          signal: controller.signal,
        });
      } catch (error) {
        if (error?.name === 'AbortError') {
          throw new Error('timeout');
        }

        throw new Error('network-error');
      }

      if (!response.ok) {
        throw new Error('http-error');
      }

      let payload;

      try {
        payload = await response.json();
      } catch {
        throw new Error('invalid-json');
      }

      return extractAnswer(payload);
    } finally {
      clearTimeout(timer);
    }
  }
}
