import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AiProviderError,
  OpenAiCompatibleProvider,
  type AiStructuredInput,
} from '../../src/ai/provider.ts';
import { StructuredAiExecutor } from '../../src/ai/structured-executor.ts';

const structuredInput: AiStructuredInput = {
  operation: 'test-operation',
  systemPrompt: 'Return JSON only.',
  content: 'test',
  schemaName: 'test_schema',
  jsonSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['value'],
    properties: { value: { type: 'string' } },
  },
};

function correctionFailureResponse(): Response {
  return new Response(
    JSON.stringify({
      error: {
        code: 'validated_output_correction_failed',
        message: 'private provider details must not be propagated',
      },
    }),
    { status: 502, headers: { 'content-type': 'application/json' } },
  );
}

test('provider classifies exhausted structured correction as non-retryable', async () => {
  const provider = new OpenAiCompatibleProvider(
    {
      baseUrl: new URL('http://provider.test/v1/'),
      model: 'test-model',
    },
    (async (input) => {
      const request = new Request(input);
      if (request.method === 'GET') return new Response('{}', { status: 404 });
      return correctionFailureResponse();
    }) as typeof fetch,
  );

  await assert.rejects(
    () => provider.executeStructured(structuredInput),
    (error: unknown) => {
      assert.ok(error instanceof AiProviderError);
      assert.equal(error.code, 'AI_PROVIDER_FAILED');
      assert.equal(error.status, 502);
      assert.equal(error.retryable, false);
      assert.equal(error.message, 'AI_PROVIDER_FAILED');
      return true;
    },
  );
});

test('structured executor never replays the original request after correction failure', async () => {
  let completionRequests = 0;
  const provider = new OpenAiCompatibleProvider(
    {
      baseUrl: new URL('http://provider.test/v1/'),
      model: 'test-model',
    },
    (async (input, init) => {
      const request = new Request(input, init);
      if (request.method === 'GET') return new Response('{}', { status: 404 });
      completionRequests += 1;
      return correctionFailureResponse();
    }) as typeof fetch,
  );
  const executor = new StructuredAiExecutor(provider, 3);

  await assert.rejects(
    () =>
      executor.execute({
        ...structuredInput,
        schema: {
          jsonSchema: structuredInput.jsonSchema,
          parse(value: unknown) {
            return value;
          },
        },
      }),
    (error: unknown) =>
      error instanceof AiProviderError &&
      error.code === 'AI_PROVIDER_FAILED' &&
      error.retryable === false,
  );

  assert.equal(completionRequests, 1);
});
