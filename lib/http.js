import { CommandError } from './helpers.js';

const USER_AGENT = 'NEXUS-CORE/1.0 (WhatsApp bot; contact via owner)';

export async function fetchJson(url, {
  method = 'GET',
  headers = {},
  body,
  timeoutMs = 15000,
  maxBytes = 1_500_000,
} = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method,
      headers: {
        accept: 'application/json',
        'user-agent': USER_AGENT,
        ...headers,
      },
      body,
      signal: controller.signal,
      redirect: 'follow',
    });

    const declaredLength = Number(response.headers.get('content-length') || 0);
    if (declaredLength > maxBytes) {
      throw new CommandError('The external service returned an oversized response.');
    }

    const text = await response.text();
    if (Buffer.byteLength(text, 'utf8') > maxBytes) {
      throw new CommandError('The external service returned an oversized response.');
    }

    if (!response.ok) {
      if (response.status === 429) {
        throw new CommandError('The external service is rate limiting requests. Try again shortly.');
      }
      throw new CommandError(`External service failed with HTTP ${response.status}.`);
    }

    try {
      return JSON.parse(text);
    } catch {
      throw new CommandError('The external service returned an invalid response.');
    }
  } catch (error) {
    if (error instanceof CommandError) throw error;
    if (error?.name === 'AbortError') {
      throw new CommandError('The external service timed out. Try again later.');
    }
    throw new CommandError('The external service could not be reached.');
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchText(url, {
  method = 'GET',
  headers = {},
  body,
  timeoutMs = 15000,
  maxBytes = 500_000,
} = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method,
      headers: { 'user-agent': USER_AGENT, ...headers },
      body,
      signal: controller.signal,
      redirect: 'follow',
    });
    if (!response.ok) {
      throw new CommandError(`External service failed with HTTP ${response.status}.`);
    }
    const text = await response.text();
    if (Buffer.byteLength(text, 'utf8') > maxBytes) {
      throw new CommandError('The external service returned an oversized response.');
    }
    return text;
  } catch (error) {
    if (error instanceof CommandError) throw error;
    if (error?.name === 'AbortError') {
      throw new CommandError('The external service timed out. Try again later.');
    }
    throw new CommandError('The external service could not be reached.');
  } finally {
    clearTimeout(timer);
  }
}
