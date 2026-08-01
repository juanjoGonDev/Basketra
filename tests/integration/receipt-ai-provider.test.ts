import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { OpenAiCompatibleProvider } from '../../src/ai/provider.ts';
import { FileStore } from '../../src/infrastructure/files.ts';
import { ReceiptExtractionService } from '../../src/receipts/service.ts';

const pngBase64 = Buffer.from(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x00])).toString('base64');

test('receipt page verification crosses the real OpenAI-compatible provider with OCR text only', async () => {
  const root = mkdtempSync(join(tmpdir(), 'basketra-openai-receipt-'));
  const requests: Array<Record<string, unknown>> = [];
  const providerServer = createServer(async (request, response) => {
    assert.equal(request.method, 'POST');
    assert.equal(request.url, '/v1/chat/completions');
    assert.equal(request.headers.authorization, 'Bearer integration-secret');
    const chunks: Uint8Array[] = [];
    for await (const chunk of request) chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
    requests.push(body);
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({
      choices: [{
        message: {
          content: JSON.stringify({
            retailerName: 'ALCAMPO ALMERIA',
            declaredTotalMinor: 20_226,
            articleCount: 88,
            currency: 'EUR',
            correctedText: '6 x ,89\nC.LADRON MANZAN 5,34 A\nTOT 202,26',
            items: [{
              description: 'C.LADRON MANZAN',
              quantity: 6,
              unitPriceMinor: 89,
              lineTotalMinor: 534,
              taxCategory: 'A',
              confidence: 0.94,
              sourceLines: [2, 3],
            }],
            warnings: [],
          }),
        },
      }],
    }));
  });

  await new Promise<void>((resolve, reject) => {
    providerServer.once('error', reject);
    providerServer.listen(0, '127.0.0.1', () => resolve());
  });
  const address = providerServer.address();
  assert.ok(address && typeof address !== 'string');

  const store = new FileStore(join(root, 'files'), join(root, 'tmp'), 16_384);
  const stored = store.storeBase64({ base64: pngBase64, mimeType: 'image/png' });
  const provider = new OpenAiCompatibleProvider({
    baseUrl: new URL(`http://127.0.0.1:${address.port}/v1/`),
    apiKey: 'integration-secret',
    model: 'gpt-5',
    timeoutMs: 2_000,
    capabilities: { image: true, pdf: false },
  });
  const service = new ReceiptExtractionService(store, () => provider, 0);

  try {
    const extraction = await service.extract(service.parseRequest({
      captures: [{
        storageKey: stored.storageKey,
        originalName: 'alcampo-page-1.png',
        embeddedText: 'ALCAMPO ALMERIA\n6 x ,89\nC.LADRON MANZAN 5,34 A\nTOT 202,26\nNUM. TOTAL ART. VENDIDOS = 88',
      }],
      verifyWithAi: true,
    }));

    assert.equal(requests.length, 1);
    const request = requests[0];
    assert.equal(request?.['model'], 'gpt-5');
    const messages = request?.['messages'] as Array<{ role: string; content: unknown }>;
    assert.equal(messages[0]?.role, 'system');
    assert.equal(messages[1]?.role, 'user');
    assert.equal(typeof messages[1]?.content, 'string');
    assert.match(String(messages[1]?.content), /1: ALCAMPO ALMERIA/u);
    assert.doesNotMatch(JSON.stringify(messages), /image_url|data:image|storageKey|integration-secret/u);

    const responseFormat = request?.['response_format'] as {
      type?: string;
      json_schema?: { strict?: boolean; schema?: { required?: string[] } };
    };
    assert.equal(responseFormat.type, 'json_schema');
    assert.equal(responseFormat.json_schema?.strict, true);
    assert.ok(responseFormat.json_schema?.schema?.required?.includes('correctedText'));
    assert.ok(responseFormat.json_schema?.schema?.required?.includes('items'));

    assert.equal(extraction.final.retailerName, 'ALCAMPO ALMERIA');
    assert.equal(extraction.final.declaredTotalMinor, 20_226);
    assert.equal(extraction.final.articleCount, 88);
    assert.deepEqual(extraction.final.items[0], {
      description: 'C.LADRON MANZAN',
      quantity: 6,
      unitPriceMinor: 89,
      lineTotalMinor: 534,
      taxCategory: 'A',
      confidence: 0.94,
      sourceLines: [2, 3],
    });
  } finally {
    service.dispose();
    provider.dispose();
    await new Promise<void>((resolve, reject) => providerServer.close((error) => error ? reject(error) : resolve()));
    rmSync(root, { recursive: true, force: true });
  }
});
