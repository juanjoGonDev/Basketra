import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { ReceiptResponsesClient } from '../../src/receipts/responses-client.ts';

const attachment = {
  mimeType: 'image/png' as const,
  bytes: Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x00]),
  fileName: 'ticket.png',
};

const interpretation = {
  retailerName: 'ALCAMPO',
  declaredTotalMinor: 120,
  currency: 'EUR' as const,
  correctedText: 'ALCAMPO\nTOTAL 1,20',
  items: [],
  warnings: [],
};

test('durable receipt responses use the Responses background contract and parse terminal output', async () => {
  const requests: Array<Readonly<{ method: string; url: string; headers: Record<string, string | string[] | undefined>; body: unknown }>> = [];
  const server = createServer(async (request, response) => {
    const chunks: Uint8Array[] = [];
    for await (const chunk of request) chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
    const bodyText = Buffer.concat(chunks).toString('utf8');
    requests.push({
      method: request.method ?? '',
      url: request.url ?? '',
      headers: request.headers,
      body: bodyText ? JSON.parse(bodyText) as unknown : undefined,
    });

    response.setHeader('content-type', 'application/json');
    if (request.method === 'POST' && request.url === '/v1/responses') {
      response.end(JSON.stringify({
        id: 'resp_1234567',
        object: 'response',
        status: 'queued',
        background: true,
        output: [],
        error: null,
      }));
      return;
    }
    if (request.method === 'GET' && request.url === '/v1/responses/resp_1234567') {
      response.end(JSON.stringify({
        id: 'resp_1234567',
        object: 'response',
        status: 'completed',
        background: true,
        error: null,
        output: [{
          type: 'message',
          role: 'assistant',
          status: 'completed',
          content: [{
            type: 'output_text',
            text: JSON.stringify(interpretation),
            annotations: [],
          }],
        }],
      }));
      return;
    }
    response.writeHead(404);
    response.end('{}');
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const client = new ReceiptResponsesClient({
    baseUrl: new URL(`http://127.0.0.1:${address.port}/v1/`),
    apiKey: 'fixture-secret',
    model: 'default',
  });

  try {
    const created = await client.create({
      idempotencyKey: 'basketra-receipt:job_1:g1:p0',
      originalText: 'ALCAMPO\nTOTAL 1,20',
      attachment,
      pageCount: 1,
      pagePosition: 0,
    });
    assert.equal(created.id, 'resp_1234567');
    assert.equal(created.status, 'queued');

    const completed = await client.get('resp_1234567', { waitSeconds: 240 });
    assert.equal(completed.status, 'completed');
    assert.deepEqual(completed.interpretation, interpretation);

    assert.equal(requests.length, 2);
    const create = requests[0]!;
    assert.equal(create.method, 'POST');
    assert.equal(create.url, '/v1/responses');
    assert.equal(create.headers['authorization'], 'Bearer fixture-secret');
    assert.equal(create.headers['idempotency-key'], 'basketra-receipt:job_1:g1:p0');
    const body = create.body as Record<string, unknown>;
    assert.equal(body['model'], 'default');
    assert.equal(body['background'], true);
    assert.equal(body['store'], true);
    assert.equal(body['stream'], false);
    assert.match(String(body['instructions']), /Keep each warning within 240 characters/u);
    const input = body['input'] as Array<{ role: string; content: Array<Record<string, unknown>> }>;
    assert.equal(input[0]?.role, 'user');
    assert.match(String(input[0]?.content[0]?.['text']), /1: ALCAMPO/u);
    assert.equal(input[0]?.content[1]?.['type'], 'input_image');
    assert.match(String(input[0]?.content[1]?.['image_url']), /^data:image\/png;base64,/u);
    const text = body['text'] as { format?: { type?: string; strict?: boolean; name?: string; schema?: Record<string, unknown> } };
    assert.equal(text.format?.type, 'json_schema');
    assert.equal(text.format?.strict, true);
    assert.equal(text.format?.name, 'receipt_page_verification');
    assert.ok(text.format?.schema?.['properties']);

    const get = requests[1]!;
    assert.equal(get.method, 'GET');
    assert.equal(get.headers['prefer'], 'wait=240');
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test('durable receipt responses expose cancellation and never include an original POST in get or cancel', async () => {
  const methods: string[] = [];
  const server = createServer(async (request, response) => {
    methods.push(`${request.method ?? ''} ${request.url ?? ''}`);
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({
      id: 'resp_7654321',
      object: 'response',
      status: request.url?.endsWith('/cancel') ? 'cancelled' : 'in_progress',
      background: true,
      output: [],
      error: null,
    }));
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const client = new ReceiptResponsesClient({
    baseUrl: new URL(`http://127.0.0.1:${address.port}/v1/`),
    model: 'default',
  });

  try {
    await client.get('resp_7654321', { waitSeconds: 5 });
    const cancelled = await client.cancel('resp_7654321');
    assert.equal(cancelled.status, 'cancelled');
    assert.deepEqual(methods, [
      'GET /v1/responses/resp_7654321',
      'POST /v1/responses/resp_7654321/cancel',
    ]);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
