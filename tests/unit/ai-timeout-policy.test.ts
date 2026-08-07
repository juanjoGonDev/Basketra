import assert from 'node:assert/strict';
import test from 'node:test';

import { OpenAiCompatibleProvider, type AiStructuredInput } from '../../src/ai/provider.ts';
import { loadConfig } from '../../src/infrastructure/config.ts';

const input: AiStructuredInput = {
  operation: 'timeout-policy',
  systemPrompt: 'Return JSON only.',
  content: 'test',
  schemaName: 'timeout_policy',
  jsonSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['value'],
    properties: { value: { type: 'string' } },
  },
};

function successfulResponse(): Response {
  return new Response(JSON.stringify({
    choices: [{ message: { content: '{"value":"ok"}' } }],
  }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

test('application configuration disables the Basketra-owned AI deadline by default', () => {
  assert.equal(loadConfig({}).aiTimeoutMs, 0);
  assert.equal(loadConfig({ BASKETRA_AI_TIMEOUT_MS: '0' }).aiTimeoutMs, 0);
  assert.equal(loadConfig({ BASKETRA_AI_TIMEOUT_MS: '5000' }).aiTimeoutMs, 5000);
  assert.throws(() => loadConfig({ BASKETRA_AI_TIMEOUT_MS: '-1' }), />= 0/);
});

test('zero timeout does not self-abort a pending provider request', async () => {
  let signal: AbortSignal | null | undefined;
  let resolveResponse: ((value: Response) => void) | undefined;
  const pendingResponse = new Promise<Response>((resolve) => {
    resolveResponse = resolve;
  });
  const provider = new OpenAiCompatibleProvider({
    baseUrl: new URL('http://provider.test/v1/'),
    model: 'test-model',
    timeoutMs: 0,
  }, (async (_url, init) => {
    signal = init?.signal;
    return await pendingResponse;
  }) as typeof fetch);

  const execution = provider.executeStructured(input);
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(signal?.aborted, false);
  resolveResponse?.(successfulResponse());
  assert.deepEqual(await execution, { value: 'ok' });
});

test('external cancellation remains authoritative when the provider deadline is disabled', async () => {
  const provider = new OpenAiCompatibleProvider({
    baseUrl: new URL('http://provider.test/v1/'),
    model: 'test-model',
    timeoutMs: 0,
  }, (async (_url, init) => await new Promise<Response>((_resolve, reject) => {
    const signal = init?.signal;
    if (signal?.aborted) {
      reject(new DOMException('aborted', 'AbortError'));
      return;
    }
    signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
  })) as typeof fetch);

  const controller = new AbortController();
  const execution = provider.executeStructured({ ...input, signal: controller.signal });
  controller.abort();
  await assert.rejects(
    () => execution,
    (error: unknown) => error instanceof DOMException && error.name === 'AbortError',
  );
});
