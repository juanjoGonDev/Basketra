import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AiProviderError,
  OpenAiCompatibleProvider,
  type AiStructuredInput,
} from '../../src/ai/provider.ts';

const input: AiStructuredInput = {
  operation: 'edge-case',
  systemPrompt: 'Return JSON only.',
  content: 'test',
  schemaName: 'edge_case',
  jsonSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['value'],
    properties: { value: { type: 'string' } },
  },
};

function provider(
  fetchImplementation: typeof fetch,
  options: Readonly<{ apiKey?: string }> = {},
): OpenAiCompatibleProvider {
  return new OpenAiCompatibleProvider({
    baseUrl: new URL('http://provider.test/v1'),
    model: 'test-model',
    ...(options.apiKey ? { apiKey: options.apiKey } : {}),
  }, fetchImplementation);
}

function responseProvider(
  status: number,
  body: BodyInit | null,
  headers: HeadersInit = { 'content-type': 'application/json' },
): OpenAiCompatibleProvider {
  return provider((async () => new Response(body, { status, headers })) as typeof fetch);
}

async function expectProviderError(
  candidate: OpenAiCompatibleProvider,
  code: AiProviderError['code'],
  options: Readonly<{ status?: number; retryable?: boolean }> = {},
): Promise<void> {
  await assert.rejects(
    () => candidate.executeStructured(input),
    (error: unknown) => {
      assert.ok(error instanceof AiProviderError);
      assert.equal(error.code, code);
      assert.equal(error.retryable, options.retryable ?? false);
      if (options.status === undefined) assert.equal(error.status, undefined);
      else assert.equal(error.status, options.status);
      return true;
    },
  );
}

test('provider ignores unavailable, oversized and malformed error metadata', async () => {
  await expectProviderError(
    responseProvider(400, '{}', { 'content-length': '9000' }),
    'AI_REQUEST_REJECTED',
    { status: 400 },
  );
  await expectProviderError(responseProvider(400, null), 'AI_REQUEST_REJECTED', { status: 400 });

  const oversizedStream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(Buffer.alloc(9 * 1024, 120));
      controller.close();
    },
  });
  await expectProviderError(
    responseProvider(500, oversizedStream),
    'AI_PROVIDER_FAILED',
    { status: 500, retryable: true },
  );

  const malformedBodies: readonly string[] = [
    'not-json',
    'null',
    '[]',
    '{"error":null}',
    '{"error":[]}',
    '{"error":{"code":42,"type":" invalid value "}}',
  ];
  for (const body of malformedBodies) {
    await expectProviderError(responseProvider(400, body), 'AI_REQUEST_REJECTED', { status: 400 });
  }
});

test('provider consumes bounded code and type metadata with stable precedence', async () => {
  await expectProviderError(
    responseProvider(503, '{"error":{"type":"composer_not_ready"}}'),
    'AI_ATTACHMENT_UPLOAD_FAILED',
    { status: 503, retryable: true },
  );
  await expectProviderError(
    responseProvider(400, '{"error":{"code":"composer_queue_timeout"}}'),
    'AI_ATTACHMENT_UPLOAD_FAILED',
    { status: 400 },
  );
  await expectProviderError(
    responseProvider(400, '{"error":{"code":"attachment_input_invalid","type":"composer_not_ready"}}'),
    'AI_REQUEST_REJECTED',
    { status: 400 },
  );
  await expectProviderError(
    responseProvider(400, '{"error":{"code":" attachment_upload_rejected "}}'),
    'AI_REQUEST_REJECTED',
    { status: 400 },
  );
});

test('provider maps every HTTP status family without leaking response bodies', async () => {
  const cases = [
    [401, 'AI_AUTHENTICATION_FAILED', false],
    [403, 'AI_AUTHENTICATION_FAILED', false],
    [408, 'AI_TIMEOUT', true],
    [504, 'AI_TIMEOUT', true],
    [413, 'AI_ATTACHMENT_TOO_LARGE', false],
    [429, 'AI_RATE_LIMITED', true],
    [500, 'AI_PROVIDER_FAILED', true],
    [422, 'AI_REQUEST_REJECTED', false],
  ] as const;

  for (const [status, code, retryable] of cases) {
    await expectProviderError(
      responseProvider(status, '{"error":{"message":"private receipt and credential data"}}'),
      code,
      { status, retryable },
    );
  }
});

test('provider distinguishes empty, malformed, aborted and unreachable responses', async () => {
  await expectProviderError(responseProvider(200, null), 'AI_EMPTY_RESPONSE', { retryable: true });
  await expectProviderError(
    responseProvider(200, '{"choices":[]}'),
    'AI_EMPTY_RESPONSE',
    { retryable: true },
  );
  await expectProviderError(responseProvider(200, 'not-json'), 'AI_INVALID_RESPONSE', { retryable: true });
  await expectProviderError(
    responseProvider(200, '{"choices":[{"message":{"content":"not-json"}}]}'),
    'AI_INVALID_RESPONSE',
    { retryable: true },
  );

  const externalController = new AbortController();
  externalController.abort();
  const aborted = provider((async (_url, init) => {
    init?.signal?.throwIfAborted();
    throw new Error('unreachable');
  }) as typeof fetch);
  await assert.rejects(
    () => aborted.executeStructured({ ...input, signal: externalController.signal }),
    (error: unknown) => error instanceof DOMException && error.name === 'AbortError',
  );

  const unreachable = provider((async () => {
    throw new TypeError('private network detail');
  }) as typeof fetch);
  await expectProviderError(unreachable, 'AI_UNREACHABLE', { retryable: true });
});

test('provider forwards only caller cancellation and synthesizes no deadline signal', async () => {
  const signals: Array<AbortSignal | null | undefined> = [];
  const candidate = provider((async (_url, init) => {
    signals.push(init?.signal);
    return new Response(JSON.stringify({
      choices: [{ message: { content: '{"value":"ok"}' } }],
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch);

  await candidate.executeStructured(input);
  const controller = new AbortController();
  await candidate.executeStructured({ ...input, signal: controller.signal });

  assert.equal(signals.length, 4);
  assert.equal(signals[0], undefined);
  assert.equal(signals[1], undefined);
  assert.equal(signals[2], controller.signal);
  assert.equal(signals[3], controller.signal);
});

test('provider capability probe rejects non-object and non-exact contracts', async () => {
  const invalidValues: readonly unknown[] = [null, [], true, { accepted: true, extra: true }];
  for (const value of invalidValues) {
    const candidate = responseProvider(200, JSON.stringify({
      choices: [{ message: { content: JSON.stringify(value) } }],
    }));
    await assert.rejects(
      () => candidate.testConnection(),
      (error: unknown) => error instanceof AiProviderError && error.code === 'AI_INVALID_STRUCTURED_OUTPUT',
    );
  }
});
