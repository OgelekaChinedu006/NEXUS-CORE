import test from 'node:test';
import assert from 'node:assert/strict';
import { OmenService } from '../services/omen.js';
import { AIService } from '../services/ai.js';
import { apiRegistry, getModels } from '../lib/api.js';
import { createConfig } from '../config/config.js';
import { createServices } from '../services/index.js';

// All requests are mocked. The keys below are fake test values.
const OWN_KEY = 'test-key-omen';
const OTHER_TIER_KEY = 'test-key-odin';
const AKASHA_KEY_1 = 'test-key-akasha-1';
const AKASHA_KEY_2 = 'test-key-akasha-2';
const CEREBRAS_KEY = 'test-key-cerebras';
const ALL_KEYS = [OWN_KEY, OTHER_TIER_KEY, AKASHA_KEY_1, AKASHA_KEY_2, CEREBRAS_KEY];

const GPT_120B = 'openai/gpt-oss-120b';
const GPT_20B = 'openai/gpt-oss-20b';
const QWEN = 'qwen/qwen3.8-27b';

function makeService({ apiKey = OWN_KEY, timeoutMs = 30000 } = {}, logger = { warn() {} }) {
  return new OmenService(
    {
      ai: {
        timeoutMs,
        maxTokens: 700,
        groqApiKey: AKASHA_KEY_1,
        groqApiKey2: AKASHA_KEY_2,
        cerebrasApiKey: CEREBRAS_KEY,
      },
      omen: { apiKey },
      odin: { apiKey: OTHER_TIER_KEY },
    },
    logger,
  );
}

function successResponse(content = 'Test answer') {
  return new Response(
    JSON.stringify({ choices: [{ message: { content } }] }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}

function recordRequests(t, respond) {
  const calls = [];

  t.mock.method(globalThis, 'fetch', async (url, options) => {
    const body = JSON.parse(options.body);
    const call = {
      url,
      model: body.model,
      key: options.headers.authorization.replace('Bearer ', ''),
      body,
    };

    calls.push(call);
    return respond(call, calls.length);
  });

  return calls;
}

test('Omen sends the first request to the top model with low reasoning, a 400 cap and only its own key', async (t) => {
  const service = makeService();
  const calls = recordRequests(t, () => successResponse('Omen answer'));

  const result = await service.chat({ system: 'Be brief.', prompt: 'Hello' });

  assert.equal(result, 'Omen answer');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.groq.com/openai/v1/chat/completions');
  assert.equal(calls[0].model, GPT_120B);
  assert.equal(calls[0].key, OWN_KEY);
  assert.equal(calls[0].body.reasoning_effort, 'low');
  assert.equal(calls[0].body.max_completion_tokens, 400);
  assert.equal('max_tokens' in calls[0].body, false);
  assert.deepEqual(calls[0].body.messages, [
    { role: 'system', content: 'Be brief.' },
    { role: 'user', content: 'Hello' },
  ]);
});

test('Omen clamps large caps to 400 and preserves lower caller caps', async (t) => {
  const service = makeService();
  const calls = recordRequests(t, () => successResponse());

  await service.chat({ prompt: 'Large', maxTokens: 5000 });
  await service.chat({ prompt: 'Small', maxTokens: 150 });
  await service.chat({ prompt: 'Default' });

  assert.deepEqual(
    calls.map((call) => call.body.max_completion_tokens),
    [400, 150, 400],
  );
});

test('Omen follows the three-slot order on transient failures using only its own key', async (t) => {
  const service = makeService();
  const calls = recordRequests(t, () =>
    new Response('Temporary server failure', { status: 503 }),
  );

  await assert.rejects(service.chat({ prompt: 'All transient' }), /HTTP 503/i);

  assert.deepEqual(
    calls.map((call) => [call.model, call.key]),
    [
      [GPT_120B, OWN_KEY],
      [GPT_20B, OWN_KEY],
      [QWEN, OWN_KEY],
    ],
  );

  for (const call of calls) {
    assert.equal(call.body.reasoning_effort, 'low');
    assert.equal(call.body.max_completion_tokens, 400);
  }
});

test('Omen recovers on a later slot after 429 and empty answers', async (t) => {
  const service = makeService();
  const calls = recordRequests(t, (_call, index) => {
    if (index === 1) return new Response('Rate limited', { status: 429 });
    if (index === 2) return successResponse('   ');
    return successResponse('Third slot answer');
  });

  const result = await service.chat({ prompt: 'Recover' });

  assert.equal(result, 'Third slot answer');
  assert.deepEqual(calls.map((call) => call.model), [GPT_120B, GPT_20B, QWEN]);
});

test('Omen treats a network error as transient and tries the next slot', async (t) => {
  const service = makeService();
  const models = [];

  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    models.push(JSON.parse(options.body).model);

    if (models.length === 1) {
      throw new TypeError('fetch failed');
    }

    return successResponse('After network error');
  });

  const result = await service.chat({ prompt: 'Network' });

  assert.equal(result, 'After network error');
  assert.deepEqual(models, [GPT_120B, GPT_20B]);
});

test('Omen maps repeated timeouts to the timeout error after trying every slot', async (t) => {
  const service = makeService();
  let calls = 0;

  t.mock.method(globalThis, 'fetch', async () => {
    calls += 1;
    const error = new Error('aborted');
    error.name = 'AbortError';
    throw error;
  });

  await assert.rejects(service.chat({ prompt: 'Timeout' }), /timed out/i);

  assert.equal(calls, 3);
});

for (const status of [401, 403]) {
  test(`Omen stops after one request on HTTP ${status} and does not leak its key`, async (t) => {
    const service = makeService();
    const calls = recordRequests(t, () => new Response('Denied', { status }));

    await assert.rejects(service.chat({ prompt: 'Auth' }), (error) => {
      assert.match(error.message, /credentials were rejected/i);

      for (const secret of ALL_KEYS) {
        assert.equal(error.message.includes(secret), false);
      }

      return true;
    });

    assert.equal(calls.length, 1);
  });
}

test('Omen stops immediately on a non-retryable error', async (t) => {
  const service = makeService();
  const calls = recordRequests(t, () => new Response('Bad request', { status: 400 }));

  await assert.rejects(service.chat({ prompt: 'Bad' }), /HTTP 400/i);

  assert.equal(calls.length, 1);
});

test('Omen never writes API keys to its logs', async (t) => {
  const warnings = [];
  const service = makeService({}, { warn: (message) => warnings.push(message) });

  recordRequests(t, () => new Response('Temporary server failure', { status: 503 }));

  await assert.rejects(service.chat({ prompt: 'Logging' }), /HTTP 503/i);

  assert.ok(warnings.length > 0);

  for (const message of warnings) {
    for (const secret of ALL_KEYS) {
      assert.equal(message.includes(secret), false);
    }
  }
});

test('Omen reports a missing key without a request, a secret, or borrowing another key', async (t) => {
  const service = makeService({ apiKey: '' });
  const calls = recordRequests(t, () => successResponse());

  assert.equal(service.available, false);
  assert.match(service.unavailableReason, /GROQ_API_KEY_OMEN/);

  await assert.rejects(service.chat({ prompt: 'Not sent' }), (error) => {
    assert.match(error.message, /GROQ_API_KEY_OMEN/);

    for (const secret of ALL_KEYS) {
      assert.equal(error.message.includes(secret), false);
    }

    return true;
  });

  assert.equal(calls.length, 0);
});

test('Omen is unavailable when its config block is absent', () => {
  const service = new OmenService({ ai: { timeoutMs: 30000 } }, { warn() {} });

  assert.equal(service.available, false);
});

test('registry keeps Akasha unchanged and defines the Omen slots', () => {
  assert.deepEqual(
    getModels('groq', 'text').map((model) => [model.priority, model.id, model.apiKeyEnv]),
    [
      [1, GPT_120B, 'GROQ_API_KEY'],
      [2, GPT_20B, 'GROQ_API_KEY'],
      [3, QWEN, 'GROQ_API_KEY'],
      [4, GPT_120B, 'GROQ_API_KEY_2'],
      [5, GPT_20B, 'GROQ_API_KEY_2'],
      [6, QWEN, 'GROQ_API_KEY_2'],
    ],
  );

  assert.equal(apiRegistry.omen.enabled, true);
  assert.deepEqual(
    getModels('omen', 'text').map((model) => [model.priority, model.id, model.apiKeyEnv]),
    [
      [1, GPT_120B, 'GROQ_API_KEY_OMEN'],
      [2, GPT_20B, 'GROQ_API_KEY_OMEN'],
      [3, QWEN, 'GROQ_API_KEY_OMEN'],
    ],
  );
});

test('Akasha does not pick up the Omen key', () => {
  const akasha = new AIService(
    {
      ai: {
        provider: 'groq',
        groqApiKey: '',
        groqApiKey2: '',
        baseUrl: '',
        apiKey: '',
        model: '',
        timeoutMs: 30000,
        maxTokens: 700,
        omenApiKey: OWN_KEY,
      },
      omen: { apiKey: OWN_KEY },
    },
    { warn() {} },
  );

  assert.equal(akasha.available, false);
});

test('config maps GROQ_API_KEY_OMEN to its own block without changing Akasha detection', () => {
  const config = createConfig({ GROQ_API_KEY_OMEN: OWN_KEY });

  assert.equal(config.omen.apiKey, OWN_KEY);
  assert.equal(config.ai.provider, 'custom');
  assert.equal(config.ai.groqApiKey, '');
  assert.equal(config.ai.groqApiKey2, '');
});

test('createServices registers omen separately from ai and thoth', () => {
  const quietLogger = { warn() {}, info() {}, error() {}, debug() {} };
  const services = createServices(
    createConfig({ GROQ_API_KEY: AKASHA_KEY_1, GROQ_API_KEY_OMEN: OWN_KEY }),
    quietLogger,
  );

  assert.equal(Object.isFrozen(services), true);
  assert.ok(services.omen instanceof OmenService);
  assert.ok(services.ai instanceof AIService);
  assert.equal(services.ai instanceof OmenService, false);
  assert.notEqual(services.ai, services.omen);
  assert.ok(services.thoth);
  assert.equal(services.omen.available, true);

  for (const name of ['ai', 'thoth', 'media', 'anime', 'weather', 'translation', 'utilities']) {
    assert.ok(name in services, `${name} must still be registered`);
  }
});

// ---------------------------------------------------------------------------
// Token-limit validation for Omen: omitted or invalid limits default to
// 400, valid lower limits are preserved, nothing ever exceeds 400.
// ---------------------------------------------------------------------------

const OMEN_INVALID_LIMITS = [
  ['zero', 0],
  ['negative', -5],
  ['NaN', Number.NaN],
  ['Infinity', Number.POSITIVE_INFINITY],
  ['-Infinity', Number.NEGATIVE_INFINITY],
  ['fraction below one', 0.5],
  ['non-numeric string', 'abc'],
  ['empty string', ''],
  ['null', null],
  ['boolean', true],
  ['object', {}],
  ['array', [300]],
];

for (const [label, value] of OMEN_INVALID_LIMITS) {
  test(`Omen treats an invalid maxTokens (${label}) as omitted and uses its 400 default`, async (t) => {
    const service = makeService();
    const calls = recordRequests(t, () => successResponse());

    await service.chat({ prompt: 'Invalid limit', maxTokens: value });

    assert.equal(calls[0].body.max_completion_tokens, 400);
    assert.ok(Number.isInteger(calls[0].body.max_completion_tokens));
  });
}

test('Omen preserves valid lower limits, floors fractions and accepts numeric strings', async (t) => {
  const service = makeService();
  const calls = recordRequests(t, () => successResponse());

  for (const maxTokens of [1, 150, '150', 150.9, 399, 400]) {
    await service.chat({ prompt: 'Lower limit', maxTokens });
  }

  assert.deepEqual(
    calls.map((call) => call.body.max_completion_tokens),
    [1, 150, 150, 150, 399, 400],
  );
});

test('Omen never requests more than 400 completion tokens', async (t) => {
  const service = makeService();
  const calls = recordRequests(t, () => successResponse());
  const requested = [401, 700, 1200, 4000, 1e9, Number.MAX_SAFE_INTEGER, '5000'];

  for (const maxTokens of requested) {
    await service.chat({ prompt: 'Large limit', maxTokens });
  }

  assert.equal(calls.length, requested.length);

  for (const call of calls) {
    assert.equal(call.body.max_completion_tokens, 400);
  }
});

test('Omen request body keeps exactly its existing Groq fields', async (t) => {
  const service = makeService();
  const calls = recordRequests(t, () => successResponse());

  await service.chat({ prompt: 'Shape', maxTokens: -1, temperature: 0.2 });

  assert.deepEqual(Object.keys(calls[0].body).sort(), [
    'max_completion_tokens',
    'messages',
    'model',
    'reasoning_effort',
    'temperature',
  ]);
  assert.equal(calls[0].body.temperature, 0.2);
  assert.equal(calls[0].body.reasoning_effort, 'low');
  assert.equal(calls[0].body.max_completion_tokens, 400);
});
