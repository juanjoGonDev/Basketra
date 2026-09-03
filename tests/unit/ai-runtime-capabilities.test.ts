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

function runtimeCapabilityBody(overrides: Readonly<{
  maxCount?: number;
  maxFileBytes?: number;
  maxImageBytes?: number;
  maxJsonBodyBytes?: number;
}> = {}): string {
  return JSON.stringify({
    attachments: {
      maxCount: overrides.maxCount ?? 10,
      maxFileBytes: overrides.maxFileBytes ?? 1024 * 1024,
      maxImageBytes: overrides.maxImageBytes ?? 1024 * 1024,
      maxSpreadsheetBytes: 1024 * 1024,
      maxUploadsPerThreeHours: 80,
    },
    execution: { replyInactivityTimeoutMs: 120_000 },
    requests: { maxJsonBodyBytes: overrides.maxJsonBodyBytes ?? 1024 * 1024 },
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

test('provider applies JSON limits only to multipart metadata, not binary attachment bytes', async () => {
  const image = Buffer.alloc(2 * 1024 * 1024, 0x61);
  const largeImageInput: AiStructuredInput = {
    ...input,
    content: [
      { type: 'text', text: 'Read the large attachment.' },
      {
        type: 'image_url',
        image_url: { url: `data:image/png;base64,${image.toString('base64')}` },
      },
    ],
  };
  let completionCalls = 0;
  const fetchImplementation = (async (url) => {
    if (new URL(String(url)).pathname.endsWith('/capabilities')) {
      return new Response(runtimeCapabilityBody({
        maxImageBytes: 4 * 1024 * 1024,
        maxJsonBodyBytes: 1024 * 1024,
      }), { status: 200 });
    }
    completionCalls += 1;
    return completionResponse();
  }) as typeof fetch;
  const provider = new OpenAiCompatibleProvider({
    baseUrl: new URL('http://provider.test/v1/'),
    model: 'test-model',
  }, fetchImplementation);

  assert.deepEqual(await provider.executeStructured(largeImageInput), { value: 'ok' });
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

test('provider applies runtime byte limits and degrades unusable capability responses safely', async () => {
  const capabilityResponses: Response[] = [
    new Response(runtimeCapabilityBody({ maxJsonBodyBytes: 1 }), { status: 200 }),
    new Response('', { status: 200, headers: { 'content-length': '9000' } }),
    new Response(new ReadableStream({ start(controller) { controller.enqueue(Buffer.alloc(33 * 1024)); controller.close(); } }), { status: 200 }),
    new Response(runtimeCapabilityBody({ maxFileBytes: 4 }), { status: 200 }),
    new Response(runtimeCapabilityBody({ maxCount: 1 }), { status: 200 }),
    new Response(JSON.stringify({
      attachments: { maxCount: 1.5, maxFileBytes: 1, maxImageBytes: 1, maxSpreadsheetBytes: 1, maxUploadsPerThreeHours: 1 },
      execution: { replyInactivityTimeoutMs: 1 },
      requests: { maxJsonBodyBytes: 1 },
    }), { status: 200 }),
    new Response('null', { status: 200, headers: { 'content-length': 'not-a-number' } }),
    new Response(runtimeCapabilityBody(), { status: 200 }),
    new Response('[]', { status: 200, headers: { 'content-length': '2' } }),
    new Response(JSON.stringify({
      attachments: { maxCount: 'one', maxFileBytes: 1, maxImageBytes: 1, maxSpreadsheetBytes: 1, maxUploadsPerThreeHours: 1 },
      execution: { replyInactivityTimeoutMs: 1 },
      requests: { maxJsonBodyBytes: 1 },
    }), { status: 200 }),
    new Response(runtimeCapabilityBody(), { status: 200 }),
  ];
  let completions = 0;
  const fetchImplementation = (async (_url, init) => {
    if (init?.method === 'GET') return capabilityResponses.shift()!;
    completions += 1;
    return completionResponse();
  }) as typeof fetch;
  const provider = new OpenAiCompatibleProvider({
    baseUrl: new URL('http://provider.test/v1/'),
    model: 'test-model',
  }, fetchImplementation);

  await assert.rejects(() => provider.executeStructured({ ...input, content: 'small request' }), /AI_ATTACHMENT_TOO_LARGE/);
  assert.deepEqual(await provider.executeStructured({ ...input, content: 'fallback after declared limit' }), { value: 'ok' });
  assert.deepEqual(await provider.executeStructured({ ...input, content: 'fallback after streamed limit' }), { value: 'ok' });
  await assert.rejects(() => provider.executeStructured({
    ...input,
    content: [{ type: 'file', file: { filename: 'large.pdf', file_data: `data:application/pdf;base64,${Buffer.from('12345').toString('base64')}` } }],
  }), /AI_ATTACHMENT_TOO_LARGE/);
  await assert.rejects(() => provider.executeStructured({
    ...input,
    content: [
      { type: 'image_url', image_url: { url: imageDataUrl } },
      { type: 'image_url', image_url: { url: imageDataUrl } },
    ],
  }), /AI_ATTACHMENT_TOO_LARGE/);
  assert.deepEqual(await provider.executeStructured({ ...input, content: 'fallback after malformed capability document' }), { value: 'ok' });
  assert.deepEqual(await provider.executeStructured({ ...input, content: 'fallback after non-object capability document' }), { value: 'ok' });
  assert.deepEqual(await provider.executeStructured({
    ...input,
    content: [{ type: 'image_url', image_url: { url: 'not-a-data-url' } }],
  }), { value: 'ok' });
  assert.deepEqual(await provider.executeStructured({ ...input, content: 'fallback after non-number capability field' }), { value: 'ok' });
  assert.deepEqual(await provider.executeStructured({ ...input, content: 'fallback after exhausted capability fixture' }), { value: 'ok' });
  assert.equal(completions, 7);
});

test('provider preserves invalid attachment metadata and moves valid files to multipart', async () => {
  let modelRequest: Request | undefined;
  const fetchImplementation = (async (url, init) => {
    if (new URL(String(url)).pathname.endsWith('/capabilities')) return new Response('{}', { status: 404 });
    modelRequest = new Request(url, init);
    return completionResponse();
  }) as typeof fetch;
  const provider = new OpenAiCompatibleProvider({
    baseUrl: new URL('http://provider.test/v1/'),
    model: 'test-model',
  }, fetchImplementation);

  assert.deepEqual(await provider.executeStructured({
    ...input,
    content: [
      { type: 'text', text: 'keep text' },
      { type: 'image_url', image_url: { url: 'not-a-data-url' } },
      { type: 'image_url', image_url: { url: 'https://provider.test/external.png' } },
      { type: 'file', file: { filename: 'external.pdf', file_data: 'https://provider.test/external.pdf' } },
      { type: 'file', file: { filename: '', file_data: `data:application/pdf;base64,${Buffer.from('%PDF').toString('base64')}` } },
      { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${Buffer.from('jpg').toString('base64')}` } },
      { type: 'file', file: { filename: '', file_data: `data:application/octet-stream;base64,${Buffer.from('bin').toString('base64')}` } },
    ],
  }), { value: 'ok' });
  assert.ok(modelRequest);
  const form = await modelRequest.formData();
  const metadata = JSON.parse(String(form.get('request'))) as { messages: Array<{ content: unknown }> };
  assert.equal(JSON.stringify(metadata.messages[1]?.content).includes('external.png'), true);
  assert.equal(JSON.stringify(metadata.messages[1]?.content).includes('external.pdf'), true);
  const files = form.getAll('files');
  assert.deepEqual(files.map(file => typeof file === 'string' ? file : `${file.name}:${file.type}`), [
    'attachment-4.pdf:application/pdf',
    'attachment-5.jpg:image/jpeg',
    'attachment-6.bin:application/octet-stream',
  ]);
});
