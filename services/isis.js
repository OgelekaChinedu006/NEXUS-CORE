import { CommandError, isHttpUrl } from '../lib/helpers.js';
import {
  GENIMAGE_DEFAULTS,
  GENIMAGE_LIMITS,
  GENIMAGE_URL,
  UNSPLASH_DEFAULTS,
  UNSPLASH_LIMITS,
  UNSPLASH_SEARCH_URL,
} from './isis-endpoints.js';

const DEFAULT_TIMEOUT_MS = 30000;
const MAX_PROMPT_LENGTH = 2000;
const MAX_QUERY_LENGTH = 200;

function normalizeTimeout(value) {
  const timeoutMs = Number(value);
  return Number.isFinite(timeoutMs) && timeoutMs > 0
    ? timeoutMs
    : DEFAULT_TIMEOUT_MS;
}

function requireText(value, message, maxLength) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new CommandError(message);
  }

  return value.trim().slice(0, maxLength);
}

function parseOptionalInteger(value, { min, max, name }) {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  let parsed;

  if (typeof value === 'number') {
    parsed = value;
  } else if (typeof value === 'string' && /^-?\d+$/.test(value.trim())) {
    parsed = Number(value.trim());
  } else {
    throw new CommandError(
      `Isis ${name} must be an integer between ${min} and ${max}.`,
    );
  }

  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new CommandError(
      `Isis ${name} must be an integer between ${min} and ${max}.`,
    );
  }

  return parsed;
}

function toCommandError(error, timeoutMessage, unreachableMessage) {
  if (error instanceof CommandError) {
    return error;
  }

  if (error?.name === 'AbortError' || error?.message === 'timeout') {
    return new CommandError(timeoutMessage);
  }

  return new CommandError(unreachableMessage);
}

export class IsisService {
  constructor(config, logger) {
    this.timeoutMs = normalizeTimeout(
      config?.media?.timeoutMs ?? config?.ai?.timeoutMs,
    );
    this.accessKey = config?.isis?.unsplashAccessKey || '';
    this.logger = logger;
  }

  get unsplashAvailable() {
    return Boolean(this.accessKey);
  }

  get unsplashUnavailableReason() {
    return this.accessKey ? '' : 'UNSPLASH_ACCESS_KEY is not configured.';
  }

  async generate({ prompt, width, height, steps } = {}) {
    const text = requireText(prompt, 'Isis requires a prompt.', MAX_PROMPT_LENGTH);
    const resolvedWidth =
      parseOptionalInteger(width, {
        min: GENIMAGE_LIMITS.minDimension,
        max: GENIMAGE_LIMITS.maxDimension,
        name: 'width',
      }) ?? GENIMAGE_DEFAULTS.width;
    const resolvedHeight =
      parseOptionalInteger(height, {
        min: GENIMAGE_LIMITS.minDimension,
        max: GENIMAGE_LIMITS.maxDimension,
        name: 'height',
      }) ?? GENIMAGE_DEFAULTS.height;
    const resolvedSteps =
      parseOptionalInteger(steps, {
        min: GENIMAGE_LIMITS.minSteps,
        max: GENIMAGE_LIMITS.maxSteps,
        name: 'steps',
      }) ?? GENIMAGE_DEFAULTS.steps;

    const payload = await this.requestJson({
      url: GENIMAGE_URL,
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        prompt: text,
        width: resolvedWidth,
        height: resolvedHeight,
        steps: resolvedSteps,
      }),
      timeoutMessage: 'Isis timed out before generating an image.',
      unreachableMessage: 'Isis could not be reached.',
    });

    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new CommandError('Isis returned an invalid generation response.');
    }

    if (payload.status !== true || !isHttpUrl(payload.image_url)) {
      throw new CommandError('Isis returned an invalid generation response.');
    }

    return {
      imageUrl: payload.image_url,
      prompt: typeof payload.prompt === 'string' ? payload.prompt : text,
      width: Number.isInteger(payload.width) ? payload.width : resolvedWidth,
      height: Number.isInteger(payload.height) ? payload.height : resolvedHeight,
      steps: Number.isInteger(payload.steps) ? payload.steps : resolvedSteps,
      imageType:
        typeof payload.image_type === 'string' ? payload.image_type : '',
      message: typeof payload.message === 'string' ? payload.message : '',
    };
  }

  async search({ query, perPage, page } = {}) {
    if (!this.unsplashAvailable) {
      throw new CommandError(
        `Isis search is dormant. ${this.unsplashUnavailableReason} Configure it in .env.`,
      );
    }

    const text = requireText(
      query,
      'Isis requires a search query.',
      MAX_QUERY_LENGTH,
    );
    const resolvedPerPage =
      parseOptionalInteger(perPage, {
        min: UNSPLASH_LIMITS.minPerPage,
        max: UNSPLASH_LIMITS.maxPerPage,
        name: 'perPage',
      }) ?? UNSPLASH_DEFAULTS.perPage;
    const resolvedPage = parseOptionalInteger(page, {
      min: UNSPLASH_LIMITS.minPage,
      max: UNSPLASH_LIMITS.maxPage,
      name: 'page',
    });

    const url = new URL(UNSPLASH_SEARCH_URL);
    url.searchParams.set('query', text);
    url.searchParams.set('per_page', String(resolvedPerPage));

    if (resolvedPage !== null) {
      url.searchParams.set('page', String(resolvedPage));
    }

    const payload = await this.requestJson({
      url,
      method: 'GET',
      headers: {
        accept: 'application/json',
        authorization: `Client-ID ${this.accessKey}`,
        'Accept-Version': 'v1',
      },
      credentialMessage:
        'Isis credentials were rejected. Check UNSPLASH_ACCESS_KEY.',
      timeoutMessage: 'Isis timed out before finishing the photo search.',
      unreachableMessage: 'Isis could not reach Unsplash.',
    });

    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new CommandError('Isis returned an invalid search response.');
    }

    if (!Array.isArray(payload.results)) {
      throw new CommandError('Isis returned an invalid search response.');
    }

    const photos = [];

    for (const result of payload.results) {
      const imageUrl = result?.urls?.regular;
      const photographer = result?.user?.name;
      const attributionUrl = result?.links?.html;

      if (!isHttpUrl(imageUrl)) {
        continue;
      }

      photos.push({
        imageUrl,
        photographer: typeof photographer === 'string' ? photographer : '',
        attributionUrl: isHttpUrl(attributionUrl) ? attributionUrl : '',
      });
    }

    if (photos.length === 0) {
      throw new CommandError('Isis found no photos for that search.');
    }

    return {
      total: Number.isInteger(payload.total) ? payload.total : photos.length,
      totalPages: Number.isInteger(payload.total_pages)
        ? payload.total_pages
        : 1,
      photos,
    };
  }

  async requestJson({
    url,
    method,
    headers,
    body,
    credentialMessage,
    timeoutMessage,
    unreachableMessage,
  }) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      let response;

      try {
        response = await fetch(url, {
          method,
          headers,
          body,
          signal: controller.signal,
        });
      } catch (error) {
        throw toCommandError(error, timeoutMessage, unreachableMessage);
      }

      if (
        credentialMessage &&
        (response.status === 401 || response.status === 403)
      ) {
        throw new CommandError(credentialMessage);
      }

      if (response.status === 429) {
        throw new CommandError(
          'Isis is rate limiting requests. Try again later.',
        );
      }

      if (!response.ok) {
        throw new CommandError(`Isis failed with HTTP ${response.status}.`);
      }

      try {
        return await response.json();
      } catch {
        throw new CommandError('Isis returned an invalid response.');
      }
    } finally {
      clearTimeout(timer);
    }
  }
}
