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
const pdfBase64 = Buffer.from('%PDF-1.4\nfixture').toString('base64');
const ocrText = 'ALCAMPO ALMERIA\n6 x ,89\nC.LADRON MANZAN 5,34 A\nTOT 202,26\nNUM. TOTAL ART. VENDIDOS = 88';

test('receipt page verification crosses the real OpenAI-compatible provider with OCR and original attachments', async () => {
  const root = mkdtempSync(join(tmpdir(), 'basketra-openai-receipt-'));
  const apiKey = `fixture-${process.pid}-${Date.now()}`;
  const requests: Array<Record<string, unknown>> = [];
  const providerServer = createServer(async (request, response) => {
    assert.equal(request.method, 'POST');
    assert.equal(request.url, '/v1/chat/completions');
    assert.equal(request.headers.authorization, `Bearer ${apiKey}`);
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
  const image = store.storeBase64({ base64: pngBase64, mimeType: 'image/png' });
  const pdf = store.storeBase64({ base64: pdfBase64, mimeType: 'application/pdf' });
  const provider = new OpenAiCompatibleProvider({
    baseUrl: new URL(`http://127.0.0.1:${address.port}/v1/`),
    apiKey,
    model: 'gpt-5',
    timeoutMs: 2_000,
    capabilities: { image: true, pdf: true },
  });
  const service = new ReceiptExtractionService(store, () => provider, 0);

  try {
    const imageExtraction = await service.extract(service.parseRequest({
      captures: [{
        storageKey: image.storageKey,
        originalName: 'alcampo-page-1.png',
        embeddedText: ocrText,
      }],
      verifyWithAi: true,
    }));
    const pdfExtraction = await service.extract(service.parseRequest({
      captures: [{
        storageKey: pdf.storageKey,
        originalName: 'alcampo-page-1.pdf',
        embeddedText: ocrText,
      }],
      verifyWithAi: true,
    }));

    assert.equal(requests.length, 2);
    const imageRequest = requests[0];
    const pdfRequest = requests[1];
    assert.equal(imageRequest?.['model'], 'gpt-5');
    assert.equal(pdfRequest?.['model'], 'gpt-5');

    const imageMessages = imageRequest?.['messages'] as Array<{ role: string; content: unknown }>;
    const pdfMessages = pdfRequest?.['messages'] as Array<{ role: string; content: unknown }>;
    assert.equal(imageMessages[0]?.role, 'system');
    assert.equal(imageMessages[1]?.role, 'user');
    assert.equal(pdfMessages[0]?.role, 'system');
    assert.equal(pdfMessages[1]?.role, 'user');

    const serializedImageContent = JSON.stringify(imageMessages[1]?.content);
    assert.match(serializedImageContent, /Numbered OCR transcription/u);
    assert.match(serializedImageContent, /1: ALCAMPO ALMERIA/u);
    assert.match(serializedImageContent, /"type":"image_url"/u);
    assert.match(serializedImageContent, /data:image\/png;base64,/u);

    const serializedPdfContent = JSON.stringify(pdfMessages[1]?.content);
    assert.match(serializedPdfContent, /Numbered OCR transcription/u);
    assert.match(serializedPdfContent, /1: ALCAMPO ALMERIA/u);
    assert.match(serializedPdfContent, /"type":"file"/u);
    assert.match(serializedPdfContent, /"filename":"alcampo-page-1.pdf"/u);
    assert.match(serializedPdfContent, /data:application\/pdf;base64,/u);

    assert.doesNotMatch(JSON.stringify([imageMessages, pdfMessages]), /storageKey/u);
    assert.doesNotMatch(JSON.stringify([imageMessages, pdfMessages]), new RegExp(apiKey, 'u'));

    for (const request of requests) {
      const responseFormat = request['response_format'] as {
        type?: string;
        json_schema?: { strict?: boolean; schema?: { required?: string[] } };
      };
      assert.equal(responseFormat.type, 'json_schema');
      assert.equal(responseFormat.json_schema?.strict, true);
      assert.ok(responseFormat.json_schema?.schema?.required?.includes('correctedText'));
      assert.ok(responseFormat.json_schema?.schema?.required?.includes('items'));
    }

    for (const extraction of [imageExtraction, pdfExtraction]) {
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
    }
  } finally {
    service.dispose();
    provider.dispose();
    await new Promise<void>((resolve, reject) => providerServer.close((error) => error ? reject(error) : resolve()));
    rmSync(root, { recursive: true, force: true });
  }
});
