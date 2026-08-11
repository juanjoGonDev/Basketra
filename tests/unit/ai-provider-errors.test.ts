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

const PROVIDER_PROBE_VISIBLE_TEXT = 'BASKETRA OCR 4821';

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

function asRecord(value: unknown): Record<string, unknown> {
  assert.equal(typeof value, 'object');
  assert.notEqual(value, null);
  assert.equal(Array.isArray(value), false);
  return value as Record<string, unknown>;
}

function asArray(value: unknown): unknown[] {
  assert.ok(Array.isArray(value));
  return value;
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

test('OpenAI-compatible provider consumes only allowlisted bounded error metadata', async () => {
  const provider = providerWithResponse(504, JSON.stringify({
    error: {
      code: 'attachment_upload_failed',
      message: 'private receipt content',
      extra: { path: '/private/receipt.png' },
    },
  }));

  await assert.rejects(
    () => provider.executeStructured(structuredInput),
    (error: unknown) => {
      assert.ok(error instanceof AiProviderError);
      assert.equal(error.code, 'AI_ATTACHMENT_UPLOAD_FAILED');
      assert.equal(error.status, 504);
      assert.equal(error.retryable, true);
      assert.doesNotMatch(String(error), /private receipt|private\/receipt/u);
      return true;
    },
  );

  const oversized = providerWithResponse(504, JSON.stringify({
    error: {
      code: 'attachment_upload_failed',
      message: 'x'.repeat(9 * 1024),
    },
  }));
  await assert.rejects(
    () => oversized.executeStructured(structuredInput),
    (error: unknown) => {
      assert.ok(error instanceof AiProviderError);
      assert.equal(error.code, 'AI_TIMEOUT');
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

test('OpenAI-compatible provider forwards only a validated correlation identifier', async () => {
  const requests: Request[] = [];
  const provider = new OpenAiCompatibleProvider({
    baseUrl: new URL('http://provider.test/v1/'),
    model: 'test-model',
  }, (async (input, init) => {
    const request = new Request(input, init);
    if (request.method === 'GET') return new Response('{}', { status: 404 });
    requests.push(request);
    return new Response(JSON.stringify({
      choices: [{ message: { content: '{"value":"ok"}' } }],
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch);

  await provider.executeStructured({ ...structuredInput, correlationId: 'receipt:abc-123' });
  await provider.executeStructured({ ...structuredInput, correlationId: 'invalid value\r\nheader' });

  assert.equal(requests[0]?.headers.get('x-client-request-id'), 'receipt:abc-123');
  assert.equal(requests[1]?.headers.get('x-client-request-id'), null);
});

test('provider capability probe verifies authenticated image OCR structured output in one model request', async () => {
  const requests: Request[] = [];
  const managedTokenFixture = ['managed', 'webapi', 'token'].join('-');
  const provider = new OpenAiCompatibleProvider({
    baseUrl: new URL('http://provider.test/v1/'),
    apiKey: managedTokenFixture,
    model: 'test-model',
  }, (async (input, init) => {
    const request = new Request(input, init);
    if (request.method === 'GET') {
      assert.equal(request.headers.get('authorization'), `Bearer ${managedTokenFixture}`);
      return new Response('{}', { status: 404 });
    }
    requests.push(request);
    return new Response(JSON.stringify({
      choices: [{
        message: {
          content: JSON.stringify({
            image: { format: 'jpg', text: PROVIDER_PROBE_VISIBLE_TEXT },
          }),
        },
      }],
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch);

  const result = await provider.testConnection();

  assert.deepEqual(result, {
    ok: true,
    model: 'test-model',
    imageStructuredOutput: true,
  });
  assert.equal(requests.length, 1);
  const request = requests[0];
  assert.ok(request);
  assert.equal(request.method, 'POST');
  assert.equal(new URL(request.url).pathname, '/v1/chat/completions');
  assert.equal(request.headers.get('authorization'), `Bearer ${managedTokenFixture}`);
  assert.match(request.headers.get('x-client-request-id') ?? '', /^provider-probe:[0-9a-f-]{36}$/u);

  const body = asRecord(await request.json());
  assert.equal(body['model'], 'test-model');
  const messages = asArray(body['messages']);
  assert.equal(messages.length, 2);
  assert.equal(String(asRecord(messages[0])['content']).includes(PROVIDER_PROBE_VISIBLE_TEXT), false);
  const userMessage = asRecord(messages[1]);
  const content = asArray(userMessage['content']);
  assert.equal(String(asRecord(content[0])['text']).includes(PROVIDER_PROBE_VISIBLE_TEXT), false);
  const imagePart = asRecord(content[1]);
  const image = asRecord(imagePart['image_url']);
  assert.equal(imagePart['type'], 'image_url');
  assert.equal(imagePart['filename'], 'test.jpg');
  assert.match(String(image['url']), /^data:image\/jpeg;base64,/u);

  const responseFormat = asRecord(body['response_format']);
  const schemaEnvelope = asRecord(responseFormat['json_schema']);
  const schema = asRecord(schemaEnvelope['schema']);
  const properties = asRecord(schema['properties']);
  const imageSchema = asRecord(properties['image']);
  const imageProperties = asRecord(imageSchema['properties']);
  const format = asRecord(imageProperties['format']);
  const text = asRecord(imageProperties['text']);
  assert.equal(responseFormat['type'], 'json_schema');
  assert.equal(schemaEnvelope['strict'], true);
  assert.deepEqual(schema['required'], ['image']);
  assert.deepEqual(imageSchema['required'], ['format', 'text']);
  assert.deepEqual(format['enum'], ['jpg']);
  assert.equal(text['type'], 'string');
});

test('provider capability probe rejects a response that did not satisfy the probe contract', async () => {
  const provider = new OpenAiCompatibleProvider({
    baseUrl: new URL('http://provider.test/v1/'),
    model: 'test-model',
  }, (async () => new Response(JSON.stringify({
    choices: [{
      message: {
        content: JSON.stringify({
          image: { format: 'jpg', text: 'WRONG OCR TEXT' },
        }),
      },
    }],
  }), { status: 200, headers: { 'content-type': 'application/json' } })) as typeof fetch);

  await assert.rejects(
    () => provider.testConnection(),
    (error: unknown) => error instanceof AiProviderError && error.code === 'AI_INVALID_RESPONSE',
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

test('structured executor retries transient provider failures within its bound and reuses correlation', async () => {
  let calls = 0;
  const correlationIds: Array<string | undefined> = [];
  const provider = executorProvider(async (input) => {
    calls += 1;
    correlationIds.push(input.correlationId);
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
  assert.equal(typeof correlationIds[0], 'string');
  assert.equal(correlationIds[0], correlationIds[1]);
});

test('API error mapping keeps AI failures actionable instead of INTERNAL_ERROR', () => {
  const rejected = mapError(new AiProviderError('AI_REQUEST_REJECTED', { status: 400 }));
  assert.equal(rejected.status, 422);
  assert.equal(rejected.code, 'AI_REQUEST_REJECTED');
  assert.match(rejected.message, /solicitud multimodal/u);

  const upload = mapError(new AiProviderError('AI_ATTACHMENT_UPLOAD_FAILED', { status: 504, retryable: true }));
  assert.equal(upload.status, 504);
  assert.equal(upload.code, 'AI_ATTACHMENT_UPLOAD_FAILED');
  assert.match(upload.message, /preparar la imagen/u);

  const timeout = mapError(new AiProviderError('AI_TIMEOUT', { status: 504, retryable: true }));
  assert.equal(timeout.status, 504);
  assert.equal(timeout.code, 'AI_TIMEOUT');
  assert.match(timeout.message, /proveedor/u);

  const failed = mapError(new AiProviderError('AI_PROVIDER_FAILED', { status: 500, retryable: true }));
  assert.equal(failed.status, 502);
  assert.equal(failed.code, 'AI_PROVIDER_FAILED');
  assert.match(failed.message, /falló al procesar/u);
});
