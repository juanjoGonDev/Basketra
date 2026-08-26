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

function postProgressFailureResponse(): Response {
  return new Response(
    JSON.stringify({
      error: {
        code: 'future_post_progress_failure',
        details: {
          originalRequestReplaySafe: false,
          retryScope: 'continuation_only',
        },
        message: 'private provider details must not be propagated',
      },
    }),
    { status: 502, headers: { 'content-type': 'application/json' } },
  );
}

test('provider preserves replay safety independently from transport retryability', async () => {
  const provider = new OpenAiCompatibleProvider(
    {
      baseUrl: new URL('http://provider.test/v1/'),
      model: 'test-model',
    },
    (async (input, init) => {
      const request = new Request(input, init);
      if (request.method === 'GET') return new Response('{}', { status: 404 });
      return postProgressFailureResponse();
    }) as typeof fetch,
  );

  await assert.rejects(
    () => provider.executeStructured(structuredInput),
    (error: unknown) => {
      assert.ok(error instanceof AiProviderError);
      assert.equal(error.code, 'AI_PROVIDER_FAILED');
      assert.equal(error.status, 502);
      assert.equal(error.retryable, true);
      assert.equal(error.originalRequestReplaySafe, false);
      assert.equal(error.retryScope, 'continuation_only');
      assert.equal(error.message, 'AI_PROVIDER_FAILED');
      return true;
    },
  );
});

test('structured executor never replays an original request marked replay unsafe', async () => {
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
      return postProgressFailureResponse();
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
      error.retryable === true &&
      error.originalRequestReplaySafe === false,
  );

  assert.equal(completionRequests, 1);
});

test('malformed replay metadata does not masquerade as post-progress semantics', async () => {
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
      if (completionRequests === 1) {
        return new Response(
          JSON.stringify({
            error: {
              code: 'temporary_failure',
              details: {
                originalRequestReplaySafe: false,
                retryScope: 'invalid_scope',
              },
            },
          }),
          { status: 502, headers: { 'content-type': 'application/json' } },
        );
      }
      return new Response(
        JSON.stringify({ choices: [{ message: { content: '{"value":"ok"}' } }] }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }) as typeof fetch,
  );
  const executor = new StructuredAiExecutor(provider, 1);

  const result = await executor.execute({
    ...structuredInput,
    schema: {
      jsonSchema: structuredInput.jsonSchema,
      parse(value: unknown) {
        return value as { value: string };
      },
    },
  });

  assert.equal(completionRequests, 2);
  assert.equal(result.attempts, 2);
  assert.deepEqual(result.value, { value: 'ok' });
});
