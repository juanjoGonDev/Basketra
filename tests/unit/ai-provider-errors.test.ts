import test from 'node:test';
import assert from 'node:assert/strict';
import { mapError } from '../../src/api/errors.ts';
import {
  AiProviderError,
  OpenAiCompatibleProvider,
  type AiProvider,
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
    properties: {
      value: { type: 'string' },
    },
  },
};

function providerWithResponse(status: number, body: string): OpenAiCompatibleProvider {
  const fetchImplementation = (async () => new Response(body, {
    status,
    headers: { 'content-type': 'application/json' },
  })) as typeof fetch;
  return new OpenAiCompatibleProvider({
    baseUrl: new URL('http://provider.test/v1/'),
    model: 'test-model',
    timeoutMs: 1000,
  }, fetchImplementation);
}

function executorProvider(executeStructured: AiProvider['executeStructured']): AiProvider {
  return {
    async getCapabilities() {
      return {
        structuredOutput: true,
        jsonObject: true,
        image: true,
        pdf: false,
        internetSearch: false,
      };
    },
    async testConnection() {
      return { ok: true };
    },
    executeStructured,
    dispose() {},
  };
}

test('OpenAI-compatible provider classifies attachment rejection without leaking its body', async () => {
  const provider = providerWithResponse(413, JSON.stringify({
    error: {
      code: 'private_provider_code',
      message: 'receipt text and credentials must never be exposed',
    },
  }));

  await assert.rejects(
    () => provider.executeStructured(structuredInput),
    (error: unknown) => {
      assert.ok(error instanceof AiProviderError);
      assert.equal(error.code, 'AI_ATTACHMENT_TOO_LARGE');
      assert.equal(error.status, 413);
      assert.equal(error.retryable, false);
      assert.equal(error.message, 'AI_ATTACHMENT_TOO_LARGE');
      assert.doesNotMatch(String(error), /receipt text|credentials|private_provider_code/u);
      return true;
    },
  );
});

test('OpenAI-compatible provider classifies retryable upstream failures', async () => {
  const provider = providerWithResponse(500, '{"error":{"message":"internal details"}}');

  await assert.rejects(
    () => provider.executeStructured(structuredInput),
    (error: unknown) => {
      assert.ok(error instanceof AiProviderError);
      assert.equal(error.code, 'AI_PROVIDER_FAILED');
      assert.equal(error.status, 500);
      assert.equal(error.retryable, true);
      return true;
    },
  );
});

test('structured executor does not retry deterministic provider rejection', async () => {
  let calls = 0;
  const provider = executorProvider(async () => {
    calls += 1;
    throw new AiProviderError('AI_REQUEST_REJECTED', { status: 400 });
  });
  const executor = new StructuredAiExecutor(provider, 3);

  await assert.rejects(
    () => executor.execute({
      ...structuredInput,
      schema: {
        jsonSchema: structuredInput.jsonSchema,
        parse(value: unknown) {
          return value;
        },
      },
    }),
    (error: unknown) => error instanceof AiProviderError && error.code === 'AI_REQUEST_REJECTED',
  );
  assert.equal(calls, 1);
});

test('structured executor retries transient provider failures within its bound', async () => {
  let calls = 0;
  const provider = executorProvider(async () => {
    calls += 1;
    if (calls === 1) throw new AiProviderError('AI_PROVIDER_FAILED', { status: 500, retryable: true });
    return { value: 'ok' };
  });
  const executor = new StructuredAiExecutor(provider, 2);

  const result = await executor.execute({
    ...structuredInput,
    schema: {
      jsonSchema: structuredInput.jsonSchema,
      parse(value: unknown) {
        return value as { value: string };
      },
    },
  });
  assert.deepEqual(result, { value: { value: 'ok' }, attempts: 2 });
  assert.equal(calls, 2);
});

test('API error mapping keeps AI failures actionable instead of INTERNAL_ERROR', () => {
  const rejected = mapError(new AiProviderError('AI_REQUEST_REJECTED', { status: 400 }));
  assert.equal(rejected.status, 422);
  assert.equal(rejected.code, 'AI_REQUEST_REJECTED');
  assert.match(rejected.message, /solicitud multimodal/u);

  const failed = mapError(new AiProviderError('AI_PROVIDER_FAILED', { status: 500, retryable: true }));
  assert.equal(failed.status, 502);
  assert.equal(failed.code, 'AI_PROVIDER_FAILED');
  assert.match(failed.message, /falló al procesar/u);
});
