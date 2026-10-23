import test from 'node:test';
import assert from 'node:assert/strict';
import { IsisService } from '../services/isis.js';
import {
  GENIMAGE_DEFAULTS,
  GENIMAGE_URL,
  UNSPLASH_SEARCH_URL,
} from '../services/isis-endpoints.js';
import { SageService } from '../services/sage.js';
import { AIService } from '../services/ai.js';
import { ThothService } from '../services/thoth.js';
import { OdinService } from '../services/odin.js';
import { OmenService } from '../services/omen.js';
import { CommandError } from '../lib/helpers.js';
import { createConfig } from '../config/config.js';
import { createServices } from '../services/index.js';

const DISTINCT_PROMPT = 'UNIQUE_ISIS_PROMPT_TOKEN_77';
const DISTINCT_QUERY = 'UNIQUE_ISIS_QUERY_TOKEN_88';
const ACCESS_KEY = 'test-unsplash-access-key';
const IMAGE_URL = 'https://cdn.example.test/generated.png';
const PHOTO_URL = 'https://images.unsplash.com/photo-test';
const PHOTO_PAGE = 'https://unsplash.com/photos/test';

function makeService(
  { accessKey = ACCESS_KEY, timeoutMs = 30000 } = {},
  logger = { warn() {} },
) {
  return new IsisService(
    {
      ai: { timeoutMs },
      media: { timeoutMs },
      isis: { unsplashAccessKey: accessKey },
    },
    logger,
  );
}

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function genImagePayload(overrides = {}) {
  return {
    status: true,
    statusCode: 200,
    service: 'GenImage',
    prompt: DISTINCT_PROMPT,
    width: 1024,
    height: 1024,
    steps: 30,
    message: 'Image generated successfully',
    image_url: IMAGE_URL,
    image_type: 'png',
    ...overrides,
  };
}

function unsplashPayload(overrides = {}) {
  return {
    total: 1,
    total_pages: 1,
    results: [
      {
        urls: { regular: PHOTO_URL },
        user: { name: 'Test Photographer' },
        links: { html: PHOTO_PAGE },
      },
    ],
    ...overrides,
  };
}

function recordRequests(t, respond) {
  const calls = [];

  t.mock.method(globalThis, 'fetch', async (url, options = {}) => {
    const parsed = new URL(String(url));
    const call = {
      url: String(url),
      origin: `${parsed.origin}${parsed.pathname}`,
      search: Object.fromEntries(parsed.searchParams.entries()),
      method: options.method,
      headers: options.headers || {},
      body: options.body ? JSON.parse(options.body) : null,
      signal: options.signal,
    };

    calls.push(call);
    return respond(call, calls.length);
  });

  return calls;
}

function assertSafeText(text) {
  const value = String(text ?? '');
  assert.equal(value.includes(DISTINCT_PROMPT), false);
  assert.equal(value.includes(DISTINCT_QUERY), false);
  assert.equal(value.includes(ACCESS_KEY), false);
  assert.equal(value.includes('Client-ID'), false);
  assert.equal(value.toLowerCase().includes('prexzy'), false);
}

test('config maps UNSPLASH_ACCESS_KEY into the Isis block', () => {
  const config = createConfig({ UNSPLASH_ACCESS_KEY: ACCESS_KEY });

  assert.equal(config.isis.unsplashAccessKey, ACCESS_KEY);
});

test('createServices registers Isis separately without replacing existing services', () => {
  const quietLogger = { warn() {}, info() {}, error() {}, debug() {} };
  const services = createServices(
    createConfig({
      GROQ_API_KEY: 'test-key-akasha-1',
      GROQ_API_KEY_ODIN: 'test-key-odin',
      GROQ_API_KEY_OMEN: 'test-key-omen',
      UNSPLASH_ACCESS_KEY: ACCESS_KEY,
    }),
    quietLogger,
  );

  assert.equal(Object.isFrozen(services), true);
  assert.ok(services.isis instanceof IsisService);
  assert.ok(services.sage instanceof SageService);
  assert.ok(services.ai instanceof AIService);
  assert.ok(services.thoth instanceof ThothService);
  assert.ok(services.odin instanceof OdinService);
  assert.ok(services.omen instanceof OmenService);
  assert.equal(services.isis instanceof SageService, false);
  assert.equal(services.sage instanceof IsisService, false);
  assert.notEqual(services.isis, services.sage);
  assert.equal(services.isis.unsplashAvailable, true);

  for (const name of [
    'ai',
    'thoth',
    'odin',
    'omen',
    'sage',
    'media',
    'anime',
    'weather',
    'translation',
    'utilities',
  ]) {
    assert.ok(name in services, `${name} must still be registered`);
  }
});

test('Isis generates an image with default GenImage parameters', async (t) => {
  const service = makeService();
  const calls = recordRequests(t, () => jsonResponse(genImagePayload()));

  const result = await service.generate({ prompt: DISTINCT_PROMPT });

  assert.deepEqual(result, {
    imageUrl: IMAGE_URL,
    prompt: DISTINCT_PROMPT,
    width: 1024,
    height: 1024,
    steps: 30,
    imageType: 'png',
    message: 'Image generated successfully',
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, 'POST');
  assert.equal(calls[0].origin, GENIMAGE_URL);
  assert.deepEqual(calls[0].body, {
    prompt: DISTINCT_PROMPT,
    width: GENIMAGE_DEFAULTS.width,
    height: GENIMAGE_DEFAULTS.height,
    steps: GENIMAGE_DEFAULTS.steps,
  });
  assert.equal(calls[0].headers.authorization, undefined);
  assert.equal(calls[0].signal instanceof AbortSignal, true);
});

test('Isis sends explicit GenImage dimensions and steps', async (t) => {
  const service = makeService();
  const calls = recordRequests(t, () =>
    jsonResponse(
      genImagePayload({ width: 512, height: 768, steps: 20, image_url: IMAGE_URL }),
    ),
  );

  const result = await service.generate({
    prompt: DISTINCT_PROMPT,
    width: 512,
    height: 768,
    steps: 20,
  });

  assert.equal(result.width, 512);
  assert.equal(result.height, 768);
  assert.equal(result.steps, 20);
  assert.deepEqual(calls[0].body, {
    prompt: DISTINCT_PROMPT,
    width: 512,
    height: 768,
    steps: 20,
  });
});

test('Isis searches Unsplash with attribution and Client-ID authentication', async (t) => {
  const service = makeService();
  const calls = recordRequests(t, () => jsonResponse(unsplashPayload()));

  const result = await service.search({ query: DISTINCT_QUERY });

  assert.deepEqual(result, {
    total: 1,
    totalPages: 1,
    photos: [
      {
        imageUrl: PHOTO_URL,
        photographer: 'Test Photographer',
        attributionUrl: PHOTO_PAGE,
      },
    ],
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, 'GET');
  assert.equal(calls[0].origin, UNSPLASH_SEARCH_URL);
  assert.equal(calls[0].search.query, DISTINCT_QUERY);
  assert.equal(calls[0].search.per_page, '10');
  assert.equal(calls[0].search.page, undefined);
  assert.equal(calls[0].headers.authorization, `Client-ID ${ACCESS_KEY}`);
  assert.equal(calls[0].headers['Accept-Version'], 'v1');
  assert.equal(calls[0].body, null);
});

test('Isis includes an optional Unsplash page parameter', async (t) => {
  const service = makeService();
  const calls = recordRequests(t, () => jsonResponse(unsplashPayload()));

  await service.search({ query: DISTINCT_QUERY, perPage: 5, page: 2 });

  assert.equal(calls[0].search.per_page, '5');
  assert.equal(calls[0].search.page, '2');
});

test('Isis reports missing Unsplash credentials without sending a request', async (t) => {
  const service = makeService({ accessKey: '' });
  const calls = recordRequests(t, () => jsonResponse(unsplashPayload()));

  assert.equal(service.unsplashAvailable, false);
  assert.match(service.unsplashUnavailableReason, /UNSPLASH_ACCESS_KEY/);

  await assert.rejects(service.search({ query: DISTINCT_QUERY }), (error) => {
    assert.equal(error instanceof CommandError, true);
    assert.match(error.message, /UNSPLASH_ACCESS_KEY/);
    assertSafeText(error.message);
    return true;
  });

  assert.equal(calls.length, 0);
});

test('Isis rejects empty prompts and search queries', async (t) => {
  const service = makeService();
  const calls = recordRequests(t, () => jsonResponse(genImagePayload()));

  for (const prompt of [undefined, null, '', '   ', 123, {}, []]) {
    await assert.rejects(service.generate({ prompt }), (error) => {
      assert.equal(error instanceof CommandError, true);
      assert.match(error.message, /requires a prompt/i);
      assertSafeText(error.message);
      return true;
    });
  }

  for (const query of [undefined, null, '', '   ', 123, {}, []]) {
    await assert.rejects(service.search({ query }), (error) => {
      assert.equal(error instanceof CommandError, true);
      assert.match(error.message, /requires a search query/i);
      assertSafeText(error.message);
      return true;
    });
  }

  assert.equal(calls.length, 0);
});

test('Isis rejects invalid GenImage dimensions and steps', async (t) => {
  const service = makeService();
  const calls = recordRequests(t, () => jsonResponse(genImagePayload()));

  for (const width of [0, -1, 63, 2049, 1.5, 'abc', true, {}, [512]]) {
    await assert.rejects(service.generate({ prompt: DISTINCT_PROMPT, width }), (error) => {
      assert.equal(error instanceof CommandError, true);
      assert.match(error.message, /width/i);
      return true;
    });
  }

  for (const height of [0, -8, 63, 3000, 12.2, 'tall']) {
    await assert.rejects(
      service.generate({ prompt: DISTINCT_PROMPT, height }),
      /height/i,
    );
  }

  for (const steps of [0, -3, 101, 4.2, 'slow']) {
    await assert.rejects(
      service.generate({ prompt: DISTINCT_PROMPT, steps }),
      /steps/i,
    );
  }

  assert.equal(calls.length, 0);
});

test('Isis rejects invalid Unsplash paging values', async (t) => {
  const service = makeService();
  const calls = recordRequests(t, () => jsonResponse(unsplashPayload()));

  await assert.rejects(
    service.search({ query: DISTINCT_QUERY, perPage: 0 }),
    /perPage/i,
  );
  await assert.rejects(
    service.search({ query: DISTINCT_QUERY, perPage: 31 }),
    /perPage/i,
  );
  await assert.rejects(
    service.search({ query: DISTINCT_QUERY, page: 0 }),
    /page/i,
  );
  await assert.rejects(
    service.search({ query: DISTINCT_QUERY, page: 1.5 }),
    /page/i,
  );

  assert.equal(calls.length, 0);
});

test('Isis maps GenImage HTTP errors without leaking prompt content', async (t) => {
  const service = makeService();
  recordRequests(t, () => new Response('down', { status: 503 }));

  await assert.rejects(service.generate({ prompt: DISTINCT_PROMPT }), (error) => {
    assert.equal(error instanceof CommandError, true);
    assert.match(error.message, /HTTP 503/i);
    assertSafeText(error.message);
    return true;
  });
});

test('Isis maps Unsplash HTTP 401 to a credential error', async (t) => {
  const service = makeService();
  recordRequests(t, () => new Response('denied', { status: 401 }));

  await assert.rejects(service.search({ query: DISTINCT_QUERY }), (error) => {
    assert.match(error.message, /credentials were rejected/i);
    assertSafeText(error.message);
    return true;
  });
});

test('Isis maps Unsplash HTTP 429 to a rate-limit error', async (t) => {
  const service = makeService();
  recordRequests(t, () => new Response('slow down', { status: 429 }));

  await assert.rejects(
    service.search({ query: DISTINCT_QUERY }),
    /rate limiting/i,
  );
});

test('Isis rejects malformed JSON from GenImage and Unsplash', async (t) => {
  const service = makeService();
  recordRequests(t, () =>
    new Response('not-json', {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  );

  await assert.rejects(
    service.generate({ prompt: DISTINCT_PROMPT }),
    /invalid response/i,
  );
  await assert.rejects(
    service.search({ query: DISTINCT_QUERY }),
    /invalid response/i,
  );
});

test('Isis rejects malformed GenImage success payloads', async (t) => {
  const service = makeService();
  const payloads = [
    { status: false, image_url: IMAGE_URL },
    { status: true, image_url: '' },
    { status: true, image_url: 'not-a-url' },
    { status: true, image_url: 'ftp://example.test/image.png' },
    { status: true },
    [],
    null,
  ];
  let index = 0;

  recordRequests(t, () => jsonResponse(payloads[index++]));

  for (let i = 0; i < payloads.length; i += 1) {
    await assert.rejects(
      service.generate({ prompt: DISTINCT_PROMPT }),
      /invalid generation response/i,
    );
  }
});

test('Isis rejects malformed Unsplash success payloads and missing photo URLs', async (t) => {
  const service = makeService();
  const payloads = [
    { total: 1, total_pages: 1 },
    { results: 'photos' },
    {
      results: [
        {
          urls: { regular: 'not-a-url' },
          user: { name: 'A' },
          links: { html: PHOTO_PAGE },
        },
      ],
    },
    { results: [] },
  ];
  let index = 0;

  recordRequests(t, () => jsonResponse(payloads[index++]));

  for (let i = 0; i < payloads.length; i += 1) {
    await assert.rejects(service.search({ query: DISTINCT_QUERY }), (error) => {
      assert.equal(error instanceof CommandError, true);
      return true;
    });
  }
});

test('Isis maps GenImage network failures and timeouts', async (t) => {
  const service = makeService();
  let calls = 0;

  t.mock.method(globalThis, 'fetch', async () => {
    calls += 1;
    throw new TypeError('fetch failed');
  });

  await assert.rejects(
    service.generate({ prompt: DISTINCT_PROMPT }),
    /could not be reached/i,
  );

  t.mock.reset();
  t.mock.method(globalThis, 'fetch', async () => {
    calls += 1;
    const error = new Error('aborted');
    error.name = 'AbortError';
    throw error;
  });

  await assert.rejects(
    service.generate({ prompt: DISTINCT_PROMPT }),
    /timed out/i,
  );
  assert.equal(calls, 2);
});

test('Isis maps Unsplash network failures and timeouts', async (t) => {
  const service = makeService();

  t.mock.method(globalThis, 'fetch', async () => {
    throw new TypeError('fetch failed');
  });

  await assert.rejects(
    service.search({ query: DISTINCT_QUERY }),
    /could not reach Unsplash/i,
  );

  t.mock.reset();
  t.mock.method(globalThis, 'fetch', async () => {
    const error = new Error('aborted');
    error.name = 'AbortError';
    throw error;
  });

  await assert.rejects(
    service.search({ query: DISTINCT_QUERY }),
    /timed out/i,
  );
});

test('Isis validates generated and searched image URLs', async (t) => {
  const service = makeService();
  recordRequests(t, (call) => {
    if (call.origin === GENIMAGE_URL) {
      return jsonResponse(genImagePayload({ image_url: 'javascript:alert(1)' }));
    }

    return jsonResponse({
      results: [
        {
          urls: { regular: 'data:image/png;base64,aaaa' },
          user: { name: 'A' },
          links: { html: PHOTO_PAGE },
        },
      ],
    });
  });

  await assert.rejects(
    service.generate({ prompt: DISTINCT_PROMPT }),
    /invalid generation response/i,
  );
  await assert.rejects(
    service.search({ query: DISTINCT_QUERY }),
    /found no photos/i,
  );
});

test('Isis never logs prompts, queries, or credentials', async (t) => {
  const warnings = [];
  const service = makeService({}, {
    warn(message) {
      warnings.push(String(message));
    },
  });
  recordRequests(t, () => new Response('down', { status: 503 }));

  await assert.rejects(service.generate({ prompt: DISTINCT_PROMPT }), /HTTP 503/i);
  await assert.rejects(service.search({ query: DISTINCT_QUERY }), /HTTP 503/i);

  for (const message of warnings) {
    assertSafeText(message);
  }
});
