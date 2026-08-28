import test from 'node:test';
import assert from 'node:assert/strict';
import { ReceiptResponsesClient } from '../../src/receipts/responses-client.ts';

const jsonResponse = (body: unknown): Response => new Response(JSON.stringify(body), {
  status: 200,
  headers: { 'content-type': 'application/json' },
});

const createInput = (idempotencyKey: string) => ({
  idempotencyKey,
  originalText: 'TOTAL 1,20',
  attachment: {
    mimeType: 'image/png' as const,
    bytes: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
  },
  pageCount: 2,
  pagePosition: idempotencyKey.endsWith('0') ? 0 : 1,
});

test('receipt Responses client permits only one non-terminal remote response at a time', async () => {
  let postCalls = 0;
  const fetchImplementation: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    if (init?.method === 'POST' && url.pathname.endsWith('/responses')) {
      postCalls += 1;
      const id = postCalls === 1 ? 'resp_1234567' : 'resp_7654321';
      return jsonResponse({ object: 'response', id, status: 'queued' });
    }
    if (init?.method === 'GET' && url.pathname.endsWith('/responses/resp_1234567')) {
      return jsonResponse({
        object: 'response',
        id: 'resp_1234567',
        status: 'failed',
        error: { code: 'test_terminal' },
      });
    }
    throw new Error(`Unexpected request: ${String(init?.method)} ${url.pathname}`);
  };
  const client = new ReceiptResponsesClient({
    baseUrl: new URL('http://127.0.0.1:3000/v1/'),
    model: 'default',
    fetchImplementation,
  });

  const first = await client.create(createInput('receipt-page-0'));
  assert.equal(first.id, 'resp_1234567');
  assert.equal(postCalls, 1);

  const secondPromise = client.create(createInput('receipt-page-1'));
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(postCalls, 1, 'second remote response must wait while the first is non-terminal');

  const terminal = await client.get('resp_1234567');
  assert.equal(terminal.status, 'failed');
  const second = await secondPromise;
  assert.equal(second.id, 'resp_7654321');
  assert.equal(postCalls, 2);
});
