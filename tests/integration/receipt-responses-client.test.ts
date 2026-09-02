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
  newCategories: [],
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
  const apiKey = ['fixture', 'credential'].join('-');
  const client = new ReceiptResponsesClient({
    baseUrl: new URL(`http://127.0.0.1:${address.port}/v1/`),
    apiKey,
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
    assert.equal(create.headers['authorization'], `Bearer ${apiKey}`);
    assert.equal(create.headers['idempotency-key'], 'basketra-receipt:job_1:g1:p0');
    const body = create.body as Record<string, unknown>;
    assert.equal(body['model'], 'default');
    assert.equal(body['background'], true);
    assert.equal(body['store'], true);
    assert.equal(body['stream'], false);
    assert.match(String(body['instructions']), /Keep each warning and unassigned-discount reason within 240 characters/u);
    const input = body['input'] as Array<{ role: string; content: Array<Record<string, unknown>> }>;
    const content = input[0]?.content ?? [];
    assert.equal(content[0]?.['type'], 'input_text');
    assert.match(String(content[0]?.['text']), /Numbered OCR transcription/u);
    assert.equal(content[1]?.['type'], 'input_image');
    assert.equal(content[1]?.['image_url'], `data:image/png;base64,${Buffer.from(attachment.bytes).toString('base64')}`);
    const text = body['text'] as Record<string, unknown>;
    const format = text['format'] as Record<string, unknown>;
    assert.equal(format['type'], 'json_schema');
    assert.equal(format['strict'], true);
    assert.equal(format['name'], 'receipt_page_verification');

    const get = requests[1]!;
    assert.equal(get.method, 'GET');
    assert.equal(get.url, '/v1/responses/resp_1234567');
    assert.equal(get.headers['authorization'], `Bearer ${apiKey}`);
    assert.equal(get.body, undefined);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test('durable receipt responses expose cancellation and never include an original POST in get or cancel', async () => {
  const requests: Array<{ method: string; url: string }> = [];
  const server = createServer(async (request, response) => {
    requests.push({ method: request.method ?? '', url: request.url ?? '' });
    response.setHeader('content-type', 'application/json');
    if (request.method === 'GET') {
      response.end(JSON.stringify({ id: 'resp_1234567', status: 'in_progress', output: [], error: null }));
      return;
    }
    if (request.method === 'POST' && request.url === '/v1/responses/resp_1234567/cancel') {
      response.end(JSON.stringify({ id: 'resp_1234567', status: 'cancelled', output: [], error: null }));
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
    model: 'default',
  });
  try {
    const running = await client.get('resp_1234567');
    assert.equal(running.status, 'in_progress');
    const cancelled = await client.cancel('resp_1234567');
    assert.equal(cancelled.status, 'cancelled');
    assert.deepEqual(requests, [
      { method: 'GET', url: '/v1/responses/resp_1234567' },
      { method: 'POST', url: '/v1/responses/resp_1234567/cancel' },
    ]);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
