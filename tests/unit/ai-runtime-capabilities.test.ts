import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AiProviderError,
  OpenAiCompatibleProvider,
  type AiStructuredInput,
} from '../../src/ai/provider.ts';

const imageDataUrl = `data:image/png;base64,${Buffer.from('0123456789').toString('base64')}`;
const input: AiStructuredInput = {
  operation: 'runtime-capabilities',
  systemPrompt: 'Return JSON only.',
  content: [
    { type: 'text', text: 'Read the attachment.' },
    { type: 'image_url', image_url: { url: imageDataUrl } },
  ],
  schemaName: 'runtime_capabilities',
  jsonSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['value'],
    properties: { value: { type: 'string' } },
  },
};

function capabilityBody(maxImageBytes: number): string {
  return JSON.stringify({
    attachments: {
      maxCount: 10,
      maxFileBytes: 1024 * 1024,
      maxImageBytes,
      maxSpreadsheetBytes: 1024 * 1024,
      maxUploadsPerThreeHours: 80,
    },
    execution: { replyInactivityTimeoutMs: 120_000 },
    requests: { maxJsonBodyBytes: 1024 * 1024 },
  });
}

function completionResponse(): Response {
  return new Response(JSON.stringify({
    choices: [{ message: { content: '{"value":"ok"}' } }],
  }), { status: 200, headers: { 'content-type': 'application/json' } });
}

test('provider fetches live capabilities before every AI request without caching', async () => {
  let capabilityReads = 0;
  let completionCalls = 0;
  const fetchImplementation = (async (url) => {
    const path = new URL(String(url)).pathname;
    if (path.endsWith('/capabilities')) {
      capabilityReads += 1;
      return new Response(capabilityBody(capabilityReads === 1 ? 4 : 1024), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    completionCalls += 1;
    return completionResponse();
  }) as typeof fetch;
  const provider = new OpenAiCompatibleProvider({
    baseUrl: new URL('http://provider.test/v1/'),
    model: 'test-model',
  }, fetchImplementation);

  await assert.rejects(
    () => provider.executeStructured(input),
    (error: unknown) =>
      error instanceof AiProviderError &&
      error.code === 'AI_ATTACHMENT_TOO_LARGE' &&
      error.status === 413,
  );
  assert.deepEqual(await provider.executeStructured(input), { value: 'ok' });
  assert.equal(capabilityReads, 2);
  assert.equal(completionCalls, 1);
});

test('provider falls back to provider enforcement when capabilities endpoint is unsupported', async () => {
  const methods: string[] = [];
  const fetchImplementation = (async (url, init) => {
    methods.push(`${init?.method ?? 'GET'} ${new URL(String(url)).pathname}`);
    if ((init?.method ?? 'GET') === 'GET') return new Response('{}', { status: 404 });
    return completionResponse();
  }) as typeof fetch;
  const provider = new OpenAiCompatibleProvider({
    baseUrl: new URL('http://generic-provider.test/v1/'),
    model: 'test-model',
  }, fetchImplementation);

  assert.deepEqual(await provider.executeStructured(input), { value: 'ok' });
  assert.deepEqual(methods, ['GET /v1/capabilities', 'POST /v1/chat/completions']);
});
