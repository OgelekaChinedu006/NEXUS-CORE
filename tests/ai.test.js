import test from 'node:test';
import assert from 'node:assert/strict';
import { AIService } from '../services/ai.js';

function makeService(aiOverrides = {}, logger = { warn() {} }) {
  return new AIService(
    {
      ai: {
        provider: 'groq',
        groqApiKey: 'test-groq-key',
        baseUrl: '',
        apiKey: '',
        model: '',
        timeoutMs: 30000,
        maxTokens: 700,
        ...aiOverrides,
      },
    },
    logger,
  );
}

function successResponse(content = 'Test answer') {
  return new Response(
    JSON.stringify({
      choices: [{ message: { content } }],
    }),
    {
      status: 200,
      headers: { 'content-type': 'application/json' },
    },
  );
}

test('Groq uses the highest-priority enabled text model first', async (t) => {
  const service = makeService();
  let request;

  t.mock.method(globalThis, 'fetch', async (url, options) => {
    request = { url, options };
    return successResponse('Verified answer');
  });

  const result = await service.chat({
    system: 'Be accurate.',
    prompt: 'Explain a test.',
  });

  assert.equal(result, 'Verified answer');
  assert.equal(
    request.url,
    'https://api.groq.com/openai/v1/chat/completions',
  );

  const body = JSON.parse(request.options.body);

  assert.equal(body.model, 'openai/gpt-oss-120b');
  assert.deepEqual(body.messages, [
    { role: 'system', content: 'Be accurate.' },
    { role: 'user', content: 'Explain a test.' },
  ]);
  assert.equal(body.reasoning_effort, 'medium');
  assert.equal(body.max_completion_tokens, 700);
  assert.equal('max_tokens' in body, false);
  assert.equal(
    request.options.headers.authorization,
    'Bearer test-groq-key',
  );
});

test('Groq clamps requested output to 1200 completion tokens', async (t) => {
  const service = makeService();
  let body;

  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    body = JSON.parse(options.body);
    return successResponse();
  });

  await service.chat({ prompt: 'Clamp test', maxTokens: 5000 });

  assert.equal(body.max_completion_tokens, 1200);
  assert.equal('max_tokens' in body, false);
});

test('Groq clamps an oversized configured default to 1200', async (t) => {
  const service = makeService({ maxTokens: 5000 });
  let body;

  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    body = JSON.parse(options.body);
    return successResponse();
  });

  await service.chat({ prompt: 'Default clamp test' });

  assert.equal(body.max_completion_tokens, 1200);
});

test('Groq preserves a lower caller-requested cap', async (t) => {
  const service = makeService();
  let body;

  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    body = JSON.parse(options.body);
    return successResponse();
  });

  await service.chat({ prompt: 'Low cap test', maxTokens: 300 });

  assert.equal(body.max_completion_tokens, 300);
});

test('Groq falls back to the next model after a retryable failure', async (t) => {
  const service = makeService();
  const attemptedModels = [];

  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    const body = JSON.parse(options.body);
    attemptedModels.push(body.model);

    if (attemptedModels.length === 1) {
      return new Response('Temporary server failure', {
        status: 503,
      });
    }

    return successResponse('Fallback answer');
  });

  const result = await service.chat({ prompt: 'Test fallback' });

  assert.equal(result, 'Fallback answer');
  assert.deepEqual(attemptedModels, [
    'openai/gpt-oss-120b',
    'openai/gpt-oss-20b',
  ]);
});

test('Groq fallback requests use the same policy', async (t) => {
  const service = makeService();
  const bodies = [];

  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    bodies.push(JSON.parse(options.body));

    if (bodies.length === 1) {
      return new Response('Temporary server failure', { status: 503 });
    }

    return successResponse('Fallback answer');
  });

  await service.chat({ prompt: 'Fallback policy test', maxTokens: 5000 });

  assert.equal(bodies.length, 2);

  for (const body of bodies) {
    assert.equal(body.reasoning_effort, 'medium');
    assert.equal(body.max_completion_tokens, 1200);
    assert.equal('max_tokens' in body, false);
  }
});

test('Groq authentication failure with a single account stops after one request', async (t) => {
  const service = makeService();
  let calls = 0;

  t.mock.method(globalThis, 'fetch', async () => {
    calls += 1;
    return new Response('Unauthorized', { status: 401 });
  });

  await assert.rejects(
    service.chat({ prompt: 'Test authentication' }),
    /credentials were rejected/i,
  );

  assert.equal(calls, 1);
});

test('Groq rejects an empty answer and tries another model', async (t) => {
  const service = makeService();
  let calls = 0;

  t.mock.method(globalThis, 'fetch', async () => {
    calls += 1;

    if (calls === 1) {
      return successResponse('   ');
    }

    return successResponse('Recovered answer');
  });

  const result = await service.chat({ prompt: 'Test empty response' });

  assert.equal(result, 'Recovered answer');
  assert.equal(calls, 2);
});

test('legacy custom-provider configuration still works', async (t) => {
  const service = makeService({
    provider: 'custom',
    baseUrl: 'https://example.test/v1/',
    apiKey: 'test-custom-key',
    model: 'custom-model',
  });

  let request;

  t.mock.method(globalThis, 'fetch', async (url, options) => {
    request = { url, options };
    return successResponse('Custom provider answer');
  });

  const result = await service.chat({ prompt: 'Test compatibility' });

  assert.equal(result, 'Custom provider answer');
  assert.equal(
    request.url,
    'https://example.test/v1/chat/completions',
  );

  assert.equal(
    JSON.parse(request.options.body).model,
    'custom-model',
  );

  assert.equal(
    request.options.headers.authorization,
    'Bearer test-custom-key',
  );
});

test('custom provider keeps max_tokens and gets no Groq parameters', async (t) => {
  const service = makeService({
    provider: 'custom',
    baseUrl: 'https://example.test/v1/',
    apiKey: 'test-custom-key',
    model: 'custom-model',
  });
  let body;

  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    body = JSON.parse(options.body);
    return successResponse();
  });

  await service.chat({ prompt: 'Custom body test', maxTokens: 3000 });

  assert.equal(body.max_tokens, 3000);
  assert.equal('max_completion_tokens' in body, false);
  assert.equal('reasoning_effort' in body, false);
});

test('Groq reports a missing API key without making a request', async (t) => {
  const service = makeService({ groqApiKey: '' });
  let calls = 0;

  t.mock.method(globalThis, 'fetch', async () => {
    calls += 1;
    return successResponse();
  });

  assert.equal(service.available, false);
  assert.match(service.unavailableReason, /GROQ_API_KEY/);

  await assert.rejects(
    service.chat({ prompt: 'This should not be sent' }),
    /Neither GROQ_API_KEY nor GROQ_API_KEY_2 is configured/i,
  );

  assert.equal(calls, 0);
});

// ---------------------------------------------------------------------------
// Account-specific authentication fallback and key-assignment regressions.
// All requests are mocked; the keys below are fake test values.
// ---------------------------------------------------------------------------

const KEY_1 = 'test-key-account-1';
const KEY_2 = 'test-key-account-2';

const GPT_120B = 'openai/gpt-oss-120b';
const GPT_20B = 'openai/gpt-oss-20b';
const QWEN = 'qwen/qwen3.8-27b';

function makeTwoAccountService(overrides = {}, logger) {
  return makeService(
    { groqApiKey: KEY_1, groqApiKey2: KEY_2, ...overrides },
    logger,
  );
}

function recordRequests(t, respond) {
  const calls = [];

  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    const body = JSON.parse(options.body);
    const call = {
      model: body.model,
      key: options.headers.authorization.replace('Bearer ', ''),
      body,
    };

    calls.push(call);
    return respond(call, calls.length);
  });

  return calls;
}

test('account 1 works without account 2 configured', async (t) => {
  const service = makeService({ groqApiKey: KEY_1, groqApiKey2: '' });
  const calls = recordRequests(t, () => successResponse('Account 1 answer'));

  const result = await service.chat({ prompt: 'Account 1 only' });

  assert.equal(result, 'Account 1 answer');
  assert.equal(service.available, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].model, GPT_120B);
  assert.equal(calls[0].key, KEY_1);
});

test('account 2 works without account 1 configured', async (t) => {
  const service = makeService({ groqApiKey: '', groqApiKey2: KEY_2 });
  const calls = recordRequests(t, () => successResponse('Account 2 answer'));

  const result = await service.chat({ prompt: 'Account 2 only' });

  assert.equal(result, 'Account 2 answer');
  assert.equal(service.available, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].model, GPT_120B);
  assert.equal(calls[0].key, KEY_2);
});

test('account 1 authentication failure proceeds to account 2', async (t) => {
  const service = makeTwoAccountService();
  const calls = recordRequests(t, (call) =>
    call.key === KEY_1
      ? new Response('Unauthorized', { status: 401 })
      : successResponse('Account 2 recovered'),
  );

  const result = await service.chat({ prompt: 'Account 1 rejected' });

  assert.equal(result, 'Account 2 recovered');
  assert.deepEqual(
    calls.map((call) => [call.model, call.key]),
    [
      [GPT_120B, KEY_1],
      [GPT_120B, KEY_2],
    ],
  );
  assert.equal(calls[1].body.reasoning_effort, 'medium');
  assert.equal(calls[1].body.max_completion_tokens, 700);
});

test('HTTP 403 on account 1 also proceeds to account 2', async (t) => {
  const service = makeTwoAccountService();
  const calls = recordRequests(t, (call) =>
    call.key === KEY_1
      ? new Response('Forbidden', { status: 403 })
      : successResponse('Account 2 after 403'),
  );

  const result = await service.chat({ prompt: 'Account 1 forbidden' });

  assert.equal(result, 'Account 2 after 403');
  assert.equal(calls.filter((call) => call.key === KEY_1).length, 1);
});

test('account 2 authentication failure does not retry that key on its remaining models', async (t) => {
  const service = makeTwoAccountService();
  const calls = recordRequests(t, (call) =>
    call.key === KEY_1
      ? new Response('Temporary server failure', { status: 503 })
      : new Response('Unauthorized', { status: 401 }),
  );

  await assert.rejects(
    service.chat({ prompt: 'Account 2 rejected' }),
    /credentials were rejected/i,
  );

  assert.deepEqual(
    calls.map((call) => [call.model, call.key]),
    [
      [GPT_120B, KEY_1],
      [GPT_20B, KEY_1],
      [QWEN, KEY_1],
      [GPT_120B, KEY_2],
    ],
  );
});

test('both accounts rejected stops after one request per key', async (t) => {
  const service = makeTwoAccountService();
  const calls = recordRequests(t, () =>
    new Response('Unauthorized', { status: 401 }),
  );

  await assert.rejects(
    service.chat({ prompt: 'Both rejected' }),
    /credentials were rejected/i,
  );

  assert.deepEqual(
    calls.map((call) => call.key),
    [KEY_1, KEY_2],
  );
});

test('a rejected key is not retried even when its earlier slot failed transiently', async (t) => {
  const service = makeTwoAccountService();
  const calls = recordRequests(t, (call, index) => {
    if (index === 1) {
      return new Response('Temporary server failure', { status: 503 });
    }

    if (call.key === KEY_1) {
      return new Response('Unauthorized', { status: 401 });
    }

    return successResponse('Account 2 answer');
  });

  const result = await service.chat({ prompt: 'Transient then auth' });

  assert.equal(result, 'Account 2 answer');
  assert.deepEqual(
    calls.map((call) => [call.model, call.key]),
    [
      [GPT_120B, KEY_1],
      [GPT_20B, KEY_1],
      [GPT_120B, KEY_2],
    ],
  );
});

test('missing assigned keys are skipped without borrowing the other account key', async (t) => {
  const warnings = [];
  const service = makeService(
    { groqApiKey: KEY_1, groqApiKey2: '' },
    { warn: (message) => warnings.push(message) },
  );
  const calls = recordRequests(t, () =>
    new Response('Temporary server failure', { status: 503 }),
  );

  await assert.rejects(
    service.chat({ prompt: 'Account 2 missing' }),
    /HTTP 503/i,
  );

  assert.deepEqual(
    calls.map((call) => [call.model, call.key]),
    [
      [GPT_120B, KEY_1],
      [GPT_20B, KEY_1],
      [QWEN, KEY_1],
    ],
  );
  assert.equal(
    warnings.filter((message) => /not configured/i.test(message)).length,
    3,
  );
});

test('account 1 slots are skipped without borrowing account 2 key', async (t) => {
  const service = makeService({ groqApiKey: '', groqApiKey2: KEY_2 });
  const calls = recordRequests(t, () =>
    new Response('Temporary server failure', { status: 503 }),
  );

  await assert.rejects(
    service.chat({ prompt: 'Account 1 missing' }),
    /HTTP 503/i,
  );

  assert.deepEqual(
    calls.map((call) => [call.model, call.key]),
    [
      [GPT_120B, KEY_2],
      [GPT_20B, KEY_2],
      [QWEN, KEY_2],
    ],
  );
});

test('transient failures follow the full six-slot order and policy', async (t) => {
  const service = makeTwoAccountService();
  const calls = recordRequests(t, () =>
    new Response('Temporary server failure', { status: 503 }),
  );

  await assert.rejects(
    service.chat({ prompt: 'All transient', maxTokens: 5000 }),
    /HTTP 503/i,
  );

  assert.deepEqual(
    calls.map((call) => [call.model, call.key]),
    [
      [GPT_120B, KEY_1],
      [GPT_20B, KEY_1],
      [QWEN, KEY_1],
      [GPT_120B, KEY_2],
      [GPT_20B, KEY_2],
      [QWEN, KEY_2],
    ],
  );

  for (const call of calls) {
    assert.equal(call.body.reasoning_effort, 'medium');
    assert.equal(call.body.max_completion_tokens, 1200);
    assert.equal('max_tokens' in call.body, false);
  }
});

test('HTTP 429 stays transient and moves to the next slot', async (t) => {
  const service = makeTwoAccountService();
  const calls = recordRequests(t, (_call, index) =>
    index === 1
      ? new Response('Rate limited', { status: 429 })
      : successResponse('After rate limit'),
  );

  const result = await service.chat({ prompt: 'Rate limit' });

  assert.equal(result, 'After rate limit');
  assert.deepEqual(
    calls.map((call) => [call.model, call.key]),
    [
      [GPT_120B, KEY_1],
      [GPT_20B, KEY_1],
    ],
  );
});

test('a non-retryable non-authentication error still stops immediately', async (t) => {
  const service = makeTwoAccountService();
  const calls = recordRequests(t, () =>
    new Response('Bad request', { status: 400 }),
  );

  await assert.rejects(
    service.chat({ prompt: 'Bad request' }),
    /HTTP 400/i,
  );

  assert.equal(calls.length, 1);
});

test('custom provider failures are not retried and keep their error mapping', async (t) => {
  const service = makeService({
    provider: 'custom',
    baseUrl: 'https://example.test/v1/',
    apiKey: 'test-custom-key',
    model: 'custom-model',
  });
  let calls = 0;
  let status = 401;

  t.mock.method(globalThis, 'fetch', async () => {
    calls += 1;
    return new Response('failure', { status });
  });

  await assert.rejects(
    service.chat({ prompt: 'Custom auth' }),
    /credentials were rejected/i,
  );
  assert.equal(calls, 1);

  status = 503;

  await assert.rejects(
    service.chat({ prompt: 'Custom outage' }),
    /HTTP 503/i,
  );
  assert.equal(calls, 2);
});

// ---------------------------------------------------------------------------
// Token-limit validation. Policy: a caller limit is valid only if it is a
// finite number (or numeric string) of at least 1; it is floored to a whole
// number. Anything else is treated as omitted and falls back to the
// configured default; if that is invalid too, to the Groq policy cap (1200)
// or the custom-provider ceiling (4000).
// ---------------------------------------------------------------------------

const INVALID_TOKEN_LIMITS = [
  ['zero', 0],
  ['negative', -5],
  ['NaN', Number.NaN],
  ['Infinity', Number.POSITIVE_INFINITY],
  ['-Infinity', Number.NEGATIVE_INFINITY],
  ['fraction below one', 0.5],
  ['non-numeric string', 'abc'],
  ['empty string', ''],
  ['whitespace string', '   '],
  ['null', null],
  ['boolean', true],
  ['object', {}],
  ['array', [300]],
];

for (const [label, value] of INVALID_TOKEN_LIMITS) {
  test(`Groq treats an invalid maxTokens (${label}) as omitted and uses the configured default`, async (t) => {
    const service = makeService();
    const calls = recordRequests(t, () => successResponse());

    await service.chat({ prompt: 'Invalid limit', maxTokens: value });

    assert.equal(calls[0].body.max_completion_tokens, 700);
    assert.ok(Number.isInteger(calls[0].body.max_completion_tokens));
    assert.equal('max_tokens' in calls[0].body, false);
  });

  test(`custom provider treats an invalid maxTokens (${label}) as omitted and uses the configured default`, async (t) => {
    const service = makeService({
      provider: 'custom',
      baseUrl: 'https://example.test/v1/',
      apiKey: 'test-custom-key',
      model: 'custom-model',
    });
    const calls = recordRequests(t, () => successResponse());

    await service.chat({ prompt: 'Invalid limit', maxTokens: value });

    assert.equal(calls[0].body.max_tokens, 700);
    assert.ok(Number.isInteger(calls[0].body.max_tokens));
  });
}

test('Groq accepts valid limits, floors fractions, accepts numeric strings and caps at 1200', async (t) => {
  const service = makeService();
  const calls = recordRequests(t, () => successResponse());
  const requested = [1, 300, '300', 150.9, 1200, 1201, 5000];

  for (const maxTokens of requested) {
    await service.chat({ prompt: 'Valid limit', maxTokens });
  }

  assert.deepEqual(
    calls.map((call) => call.body.max_completion_tokens),
    [1, 300, 300, 150, 1200, 1200, 1200],
  );
});

test('Groq request body keeps exactly its existing fields', async (t) => {
  const service = makeService();
  const calls = recordRequests(t, () => successResponse());

  await service.chat({ prompt: 'Shape', maxTokens: 0, temperature: 0.3 });

  assert.deepEqual(Object.keys(calls[0].body).sort(), [
    'max_completion_tokens',
    'messages',
    'model',
    'reasoning_effort',
    'temperature',
  ]);
  assert.equal(calls[0].body.temperature, 0.3);
  assert.equal(calls[0].body.reasoning_effort, 'medium');
});

test('Groq falls back to the 1200 policy cap when both the caller and the configured default are invalid', async (t) => {
  const calls = recordRequests(t, () => successResponse());

  await makeService({ maxTokens: undefined }).chat({
    prompt: 'No default',
    maxTokens: 0,
  });
  await makeService({ maxTokens: 0 }).chat({ prompt: 'Zero default' });

  assert.deepEqual(
    calls.map((call) => call.body.max_completion_tokens),
    [1200, 1200],
  );
});

test('Groq fallback requests also use the validated limit', async (t) => {
  const service = makeService();
  const calls = recordRequests(t, (_call, index) =>
    index === 1
      ? new Response('Temporary server failure', { status: 503 })
      : successResponse(),
  );

  await service.chat({ prompt: 'Fallback limit', maxTokens: -10 });

  assert.equal(calls.length, 2);

  for (const call of calls) {
    assert.equal(call.body.max_completion_tokens, 700);
    assert.equal(call.body.reasoning_effort, 'medium');
  }
});

test('custom provider keeps legacy max_tokens behaviour: valid values, 4000 ceiling, no Groq fields', async (t) => {
  const service = makeService({
    provider: 'custom',
    baseUrl: 'https://example.test/v1/',
    apiKey: 'test-custom-key',
    model: 'custom-model',
  });
  const calls = recordRequests(t, () => successResponse());

  await service.chat({ prompt: 'Omitted' });
  await service.chat({ prompt: 'Valid', maxTokens: 3000 });
  await service.chat({ prompt: 'Above ceiling', maxTokens: 5000 });
  await service.chat({ prompt: 'Numeric string', maxTokens: '300' });
  await service.chat({ prompt: 'Fraction', maxTokens: 150.9 });

  assert.deepEqual(
    calls.map((call) => call.body.max_tokens),
    [700, 3000, 4000, 300, 150],
  );
  assert.deepEqual(Object.keys(calls[0].body).sort(), [
    'max_tokens',
    'messages',
    'model',
    'temperature',
  ]);
});

test('custom provider falls back to the 4000 ceiling when both limits are invalid', async (t) => {
  const service = makeService({
    provider: 'custom',
    baseUrl: 'https://example.test/v1/',
    apiKey: 'test-custom-key',
    model: 'custom-model',
    maxTokens: undefined,
  });
  const calls = recordRequests(t, () => successResponse());

  await service.chat({ prompt: 'No default', maxTokens: Number.NaN });

  assert.equal(calls[0].body.max_tokens, 4000);
});
