import test from 'node:test';
import assert from 'node:assert/strict';
import { ThothService } from '../services/thoth.js';

function makeService(client, aiOverrides = {}) {
  return new ThothService(
    {
      ai: {
        cerebrasApiKey: 'test-cerebras-key',
        timeoutMs: 30000,
        ...aiOverrides,
      },
    },
    { warn() {} },
    client,
  );
}

function success(content = 'Verified answer') {
  return {
    choices: [{ message: { content } }],
  };
}

test('Thoth uses Qwen first, disables reasoning, and caps output at 400 tokens', async () => {
  let request;

  const client = {
    chat: {
      completions: {
        create: async (options) => {
          request = options;
          return success();
        },
      },
    },
  };

  const service = makeService(client);

  const result = await service.chat({
    system: 'Be concise.',
    prompt: 'Explain API fallback.',
    maxTokens: 1200,
  });

  assert.equal(result, 'Verified answer');
  assert.equal(request.model, 'qwen-3.8-27b');
  assert.equal(request.reasoning_effort, 'none');
  assert.equal(request.max_completion_tokens, 400);
  assert.equal(request.stream, false);
  assert.deepEqual(request.messages, [
    { role: 'system', content: 'Be concise.' },
    { role: 'user', content: 'Explain API fallback.' },
  ]);
});

test('Thoth falls back to GPT-OSS with its supported reasoning setting', async () => {
  const attemptedRequests = [];

  const client = {
    chat: {
      completions: {
        create: async ({ model, reasoning_effort }) => {
          attemptedRequests.push({ model, reasoning_effort });

          if (model === 'qwen-3.8-27b') {
            throw new Error('Temporary model failure');
          }

          return success('Fallback answer');
        },
      },
    },
  };

  const service = makeService(client);
  const result = await service.chat({ prompt: 'Test fallback' });

  assert.equal(result, 'Fallback answer');
  assert.deepEqual(attemptedRequests, [
    { model: 'qwen-3.8-27b', reasoning_effort: 'none' },
    { model: 'gpt-oss-120b', reasoning_effort: 'low' },
  ]);
});

test('Thoth stops on rejected credentials', async () => {
  let calls = 0;

  const client = {
    chat: {
      completions: {
        create: async () => {
          calls += 1;
          const error = new Error('Unauthorized');
          error.status = 401;
          throw error;
        },
      },
    },
  };

  const service = makeService(client);

  await assert.rejects(
    service.chat({ prompt: 'Test authentication' }),
    /credentials were rejected/i,
  );

  assert.equal(calls, 1);
});

test('Thoth rejects missing credentials without calling the API', async () => {
  let calls = 0;

  const client = {
    chat: {
      completions: {
        create: async () => {
          calls += 1;
          return success();
        },
      },
    },
  };

  const service = makeService(client, {
    cerebrasApiKey: '',
  });

  assert.equal(service.available, false);

  await assert.rejects(
    service.chat({ prompt: 'Must not be sent' }),
    /CEREBRAS_API_KEY is not configured/i,
  );

  assert.equal(calls, 0);
});