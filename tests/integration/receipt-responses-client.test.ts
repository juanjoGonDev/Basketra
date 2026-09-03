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

test('durable receipt responses send binary multipart and parse terminal output', async () => {
  const requests: Array<Readonly<{
    method: string;
    url: string;
    headers: Record<string, string | string[] | undefined>;
    body: Buffer;
  }>> = [];
  const server = createServer(async (request, response) => {
    const chunks: Uint8Array[] = [];
    for await (const chunk of request) chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
    requests.push({
      method: request.method ?? '',
      url: request.url ?? '',
      headers: request.headers,
      body: Buffer.concat(chunks),
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
    assert.match(String(create.headers['content-type']), /^multipart\/form-data; boundary=/u);
    assert.ok(create.body.indexOf(Buffer.from(attachment.bytes)) >= 0);
    assert.equal(create.body.includes(Buffer.from(Buffer.from(attachment.bytes).toString('base64'), 'utf8')), false);

    const contentType = create.headers['content-type'];
    assert.equal(typeof contentType, 'string');
    const parsedRequest = new Request('http://localhost/v1/responses', {
      method: 'POST',
      headers: { 'content-type': contentType as string },
      body: new Uint8Array(create.body),
    });
    const form = await parsedRequest.formData();
    const metadataValue = form.get('request');
    assert.equal(typeof metadataValue, 'string');
    const body = JSON.parse(metadataValue as string) as Record<string, unknown>;
    assert.equal(body['model'], 'default');
    assert.equal(body['background'], true);
    assert.equal(body['store'], true);
    assert.equal(body['stream'], false);
    assert.match(String(body['instructions']), /Keep each warning and unassigned-discount reason within 240 characters/u);
    const input = body['input'] as Array<{ role: string; content: Array<Record<string, unknown>> }>;
    assert.equal(input[0]?.role, 'user');
    assert.match(String(input[0]?.content[0]?.['text']), /1: ALCAMPO/u);
    assert.equal(input[0]?.content.length, 1);
    const file = form.get('files');
    assert.ok(file instanceof File);
    assert.equal(file.name, 'ticket.png');
    assert.equal(file.type, 'image/png');
    assert.deepEqual(Buffer.from(await file.arrayBuffer()), Buffer.from(attachment.bytes));
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
