import test from 'node:test';
import assert from 'node:assert/strict';
import { SageService } from '../services/sage.js';
import { SAGE_BASE_URL, SAGE_ENDPOINTS } from '../services/sage-endpoints.js';
import { AIService } from '../services/ai.js';
import { ThothService } from '../services/thoth.js';
import { OdinService } from '../services/odin.js';
import { OmenService } from '../services/omen.js';
import { CommandError } from '../lib/helpers.js';
import { createConfig } from '../config/config.js';
import { createServices } from '../services/index.js';

const DISTINCT_PROMPT = 'UNIQUE_SAGE_PROMPT_TOKEN_42';
const SECRET = 'test-key-should-never-leak';

const EXPECTED_ENDPOINTS = [
  ['/ai/deepseek-v4-1-flash', 'text'],
  ['/ai/deepseek-v4-1-flash-1017', 'text'],
  ['/ai/askgpt5', 'prompt'],
  ['/ai/glm-5-3-flash', 'text'],
  ['/ai/glm-5-3', 'text'],
  ['/ai/qwen', 'prompt'],
  ['/ai/qwen3-8-27b', 'text'],
];

function makeService(logger = { warn() {} }, timeoutMs = 30000) {
  return new SageService({ ai: { timeoutMs } }, logger);
}

function successResponse(answer = 'Sage answer') {
  return new Response(JSON.stringify({ status: 200, response: answer }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function recordRequests(t, respond) {
  const calls = [];

  t.mock.method(globalThis, 'fetch', async (url, options) => {
    const body = options.body ? JSON.parse(options.body) : {};
    const call = {
      url,
      method: options.method,
      headers: options.headers,
      body,
      signal: options.signal,
    };

    calls.push(call);
    return respond(call, calls.length);
  });

  return calls;
}

function assertSafeText(text, prompt = DISTINCT_PROMPT) {
  const value = String(text ?? '');
  assert.equal(value.includes(prompt), false);
  assert.equal(value.toLowerCase().includes('prexzy'), false);
  assert.equal(value.includes(SAGE_BASE_URL), false);
  assert.equal(value.includes(SECRET), false);
  assert.equal(value.includes('authorization'), false);
  assert.equal(value.includes('Bearer'), false);
}

test('Sage endpoint catalogue uses the exact Prexzy fallback order and fields', () => {
  assert.equal(SAGE_BASE_URL, 'https://prexzyapis.com');
  assert.equal(SAGE_ENDPOINTS.length, 7);
  assert.deepEqual(
    SAGE_ENDPOINTS.map((endpoint) => [endpoint.path, endpoint.field]),
    EXPECTED_ENDPOINTS,
  );
});

test('Sage sends the prompt on the first endpoint using the text field', async (t) => {
  const service = makeService();
  const calls = recordRequests(t, () => successResponse('First answer'));

  const result = await service.chat({ prompt: DISTINCT_PROMPT });

  assert.equal(result, 'First answer');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, 'POST');
  assert.equal(calls[0].url, `${SAGE_BASE_URL}/ai/deepseek-v4-1-flash`);
  assert.deepEqual(calls[0].body, { text: DISTINCT_PROMPT });
  assert.equal(calls[0].headers['content-type'], 'application/json');
  assert.equal(calls[0].headers.authorization, undefined);
  assert.equal(calls[0].signal instanceof AbortSignal, true);
});

test('Sage uses each endpoint in order with the exact required field and no extra AskGPT5 parameters', async (t) => {
  const service = makeService();
  const calls = recordRequests(t, () => new Response('down', { status: 503 }));

  await assert.rejects(
    service.chat({ prompt: DISTINCT_PROMPT }),
    /could not get a valid response/i,
  );

  assert.equal(calls.length, 7);
  assert.deepEqual(
    calls.map((call) => [
      call.url.replace(SAGE_BASE_URL, ''),
      Object.keys(call.body).sort().join(','),
    ]),
    EXPECTED_ENDPOINTS.map(([path, field]) => [path, field]),
  );

  for (const [index, call] of calls.entries()) {
    const [, field] = EXPECTED_ENDPOINTS[index];
    assert.equal(call.method, 'POST');
    assert.deepEqual(Object.keys(call.body), [field]);
    assert.equal(call.body[field], DISTINCT_PROMPT);
    assert.equal('state' in call.body, false);
    assert.equal('media' in call.body, false);
    assert.equal('model' in call.body, false);
    assert.equal('web_search' in call.body, false);
    assert.equal('webSearch' in call.body, false);
    assert.equal(call.headers.authorization, undefined);
  }
});

test('Sage returns the trimmed answer from the first successful endpoint', async (t) => {
  const service = makeService();
  const calls = recordRequests(t, () => successResponse('  Trimmed sage  '));

  const result = await service.chat({ prompt: '  Hello sage  ' });

  assert.equal(result, 'Trimmed sage');
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].body, { text: 'Hello sage' });
});

test('Sage falls back after HTTP errors including 429 and 5xx', async (t) => {
  const statuses = [429, 500, 502, 503, 404];
  const service = makeService();
  const calls = recordRequests(t, (_call, index) => {
    if (index <= statuses.length) {
      return new Response('http failure', { status: statuses[index - 1] });
    }

    return successResponse('Recovered after HTTP errors');
  });

  const result = await service.chat({ prompt: DISTINCT_PROMPT });

  assert.equal(result, 'Recovered after HTTP errors');
  assert.equal(calls.length, statuses.length + 1);
  assert.equal(calls.at(-1).url, `${SAGE_BASE_URL}/ai/qwen`);
});

test('Sage falls back after network errors and timeouts', async (t) => {
  const service = makeService();
  const calls = recordRequests(t, (_call, index) => {
    if (index === 1) {
      throw new TypeError('fetch failed');
    }

    if (index === 2) {
      const error = new Error('aborted');
      error.name = 'AbortError';
      throw error;
    }

    return successResponse('Recovered after network and timeout');
  });

  const result = await service.chat({ prompt: DISTINCT_PROMPT });

  assert.equal(result, 'Recovered after network and timeout');
  assert.equal(calls.length, 3);
  assert.equal(calls[2].url, `${SAGE_BASE_URL}/ai/askgpt5`);
  assert.deepEqual(calls[2].body, { prompt: DISTINCT_PROMPT });
});

test('Sage falls back after invalid JSON, unsuccessful status, missing response, and empty answers', async (t) => {
  const service = makeService();
  const sequence = [
    () => new Response('not-json', { status: 200, headers: { 'content-type': 'application/json' } }),
    () => jsonResponse({ status: false, response: 'ignored' }),
    () => jsonResponse({ status: 'error', response: 'ignored' }),
    () => jsonResponse({ status: 200 }),
    () => jsonResponse({ status: 200, response: '   ' }),
    () => jsonResponse({ status: 200, response: '' }),
    () => successResponse('Recovered after bad payloads'),
  ];
  const calls = recordRequests(t, (_call, index) => sequence[index - 1]());

  const result = await service.chat({ prompt: DISTINCT_PROMPT });

  assert.equal(result, 'Recovered after bad payloads');
  assert.equal(calls.length, 7);
  assert.equal(calls.at(-1).url, `${SAGE_BASE_URL}/ai/qwen3-8-27b`);
});

test('Sage recovers from an empty Qwen AI Chat response on Qwen 3.8 27B', async (t) => {
  const service = makeService();
  const calls = recordRequests(t, (call) => {
    if (call.url.endsWith('/ai/qwen')) {
      return jsonResponse({ status: 200, response: '' });
    }

    if (call.url.endsWith('/ai/qwen3-8-27b')) {
      return successResponse('Qwen 3.8 27B answer');
    }

    return new Response('down', { status: 503 });
  });

  const result = await service.chat({ prompt: DISTINCT_PROMPT });

  assert.equal(result, 'Qwen 3.8 27B answer');
  assert.deepEqual(
    calls.map((call) => call.url.replace(SAGE_BASE_URL, '')),
    EXPECTED_ENDPOINTS.map(([path]) => path),
  );
  assert.deepEqual(calls.at(-2).body, { prompt: DISTINCT_PROMPT });
  assert.deepEqual(calls.at(-1).body, { text: DISTINCT_PROMPT });
});

test('Sage throws a controlled error when every endpoint fails', async (t) => {
  const service = makeService();
  const calls = recordRequests(t, () => new Response('down', { status: 503 }));

  await assert.rejects(service.chat({ prompt: DISTINCT_PROMPT }), (error) => {
    assert.equal(error instanceof CommandError, true);
    assert.match(error.message, /could not get a valid response/i);
    assertSafeText(error.message);
    return true;
  });

  assert.equal(calls.length, 7);
});

test('Sage validates input and keeps error messages safe', async (t) => {
  const service = makeService();
  const calls = recordRequests(t, () => successResponse());

  for (const prompt of [undefined, null, '', '   ', 123, {}, []]) {
    await assert.rejects(service.chat({ prompt }), (error) => {
      assert.equal(error instanceof CommandError, true);
      assert.match(error.message, /requires a prompt/i);
      assertSafeText(error.message);
      return true;
    });
  }

  await assert.rejects(service.chat(), /requires a prompt/i);
  assert.equal(calls.length, 0);
});

test('createServices registers Sage separately without replacing existing services', () => {
  const quietLogger = { warn() {}, info() {}, error() {}, debug() {} };
  const services = createServices(
    createConfig({
      GROQ_API_KEY: 'test-key-akasha-1',
      GROQ_API_KEY_ODIN: 'test-key-odin',
      GROQ_API_KEY_OMEN: 'test-key-omen',
    }),
    quietLogger,
  );

  assert.equal(Object.isFrozen(services), true);
  assert.ok(services.sage instanceof SageService);
  assert.ok(services.ai instanceof AIService);
  assert.ok(services.thoth instanceof ThothService);
  assert.ok(services.odin instanceof OdinService);
  assert.ok(services.omen instanceof OmenService);
  assert.equal(services.ai instanceof SageService, false);
  assert.equal(services.sage instanceof AIService, false);
  assert.notEqual(services.ai, services.sage);
  assert.notEqual(services.thoth, services.sage);
  assert.notEqual(services.odin, services.sage);
  assert.notEqual(services.omen, services.sage);

  assert.deepEqual(
    Object.keys(services).sort(),
    [
      'ai',
      'anime',
      'isis',
      'media',
      'odin',
      'omen',
      'sage',
      'thoth',
      'translation',
      'utilities',
      'weather',
    ].sort(),
  );
});

test('Sage does not log prompts, secrets, or provider internals and never uses live fetch', async (t) => {
  const warnings = [];
  const service = makeService({
    warn(message) {
      warnings.push(String(message));
    },
  });
  const calls = recordRequests(t, () => new Response('down', { status: 503 }));

  await assert.rejects(service.chat({ prompt: DISTINCT_PROMPT }), /could not get a valid response/i);

  assert.equal(calls.length, 7);
  assert.ok(warnings.length > 0);

  for (const message of warnings) {
    assertSafeText(message);
  }

  for (const call of calls) {
    assert.match(call.url, /^https:\/\/prexzyapis\.com\/ai\//);
  }
});
