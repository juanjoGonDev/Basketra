import test from 'node:test';
import assert from 'node:assert/strict';
import { OpenAiCompatibleProvider } from '../../src/ai/provider.ts';

const request = {
  operation: 'bounded-response',
  schemaName: 'bounded_response',
  systemPrompt: 'Return JSON',
  content: 'x',
  jsonSchema: { type: 'object' },
} as const;

function modelResponseOnly(responseFactory: () => Response): typeof fetch {
  return (async (input, init) => {
    const providerRequest = new Request(input, init);
    if (providerRequest.method === 'GET') return new Response('{}', { status: 404 });
    return responseFactory();
  }) as typeof fetch;
}

test('AI responses reject an oversized declared content length before buffering', async () => {
  const provider = new OpenAiCompatibleProvider(
    { baseUrl: new URL('http://localhost/v1/'), model: 'x', timeoutMs: 1_000, maxResponseBytes: 16 },
    modelResponseOnly(() => new Response('small', { status: 200, headers: { 'content-length': '17' } })),
  );
  await assert.rejects(() => provider.executeStructured(request), /AI_RESPONSE_TOO_LARGE/);
});

test('AI responses stop streaming after the configured byte budget', async () => {
  let cancelled = false;
  const provider = new OpenAiCompatibleProvider(
    { baseUrl: new URL('http://localhost/v1/'), model: 'x', timeoutMs: 1_000, maxResponseBytes: 16 },
    modelResponseOnly(() => {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(Buffer.from('{"choices":['));
          controller.enqueue(Buffer.from('0123456789'));
        },
        cancel() {
          cancelled = true;
        },
      });
      return new Response(body, { status: 200 });
    }),
  );
  await assert.rejects(() => provider.executeStructured(request), /AI_RESPONSE_TOO_LARGE/);
  assert.equal(cancelled, true);
});

test('AI responses accept bounded structured output', async () => {
  const response = JSON.stringify({ choices: [{ message: { content: '{"value":2}' } }] });
  const provider = new OpenAiCompatibleProvider(
    { baseUrl: new URL('http://localhost/v1/'), model: 'x', timeoutMs: 1_000, maxResponseBytes: 256 },
    modelResponseOnly(() => new Response(response, { status: 200 })),
  );
  assert.deepEqual(await provider.executeStructured(request), { value: 2 });
  assert.throws(
    () => new OpenAiCompatibleProvider({ baseUrl: new URL('http://localhost/v1/'), model: 'x', timeoutMs: 1_000, maxResponseBytes: 0 }),
    /positive safe integer/,
  );
});
