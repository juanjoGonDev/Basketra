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
  const requests: Array<Readonly<{
    body: Record<string, unknown>;
    files: ReadonlyArray<Readonly<{ name: string; type: string; bytes: Buffer }>>;
  }>> = [];
  let providerError: unknown;
  const providerServer = createServer(async (request, response) => {
    try {
      if (request.method === 'GET') {
        assert.equal(request.url, '/v1/capabilities');
        response.writeHead(404, { 'content-type': 'application/json' });
        response.end('{}');
        return;
      }
      assert.equal(request.method, 'POST');
      assert.equal(request.url, '/v1/chat/completions');
      assert.equal(request.headers.authorization, `Bearer ${apiKey}`);
      const chunks: Uint8Array[] = [];
      for await (const chunk of request) chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
      const contentType = request.headers['content-type'];
      assert.equal(typeof contentType, 'string');
      const form = await new Response(Buffer.concat(chunks), { headers: { 'content-type': contentType } }).formData();
      const metadata = form.get('request');
      assert.equal(typeof metadata, 'string');
      const files = await Promise.all(form.getAll('files').map(async (file) => {
        assert.notEqual(typeof file, 'string');
        if (typeof file === 'string') throw new Error('missing receipt attachment');
        return { name: file.name, type: file.type, bytes: Buffer.from(await file.arrayBuffer()) };
      }));
      requests.push({ body: JSON.parse(metadata), files });
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
    } catch (error) {
      providerError = error;
      response.writeHead(500, { 'content-type': 'application/json' });
      response.end('{}');
    }
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
    assert.ifError(providerError);
    const imageRequest = requests[0];
    const pdfRequest = requests[1];
    assert.equal(imageRequest?.body['model'], 'gpt-5');
    assert.equal(pdfRequest?.body['model'], 'gpt-5');

    const imageMessages = imageRequest?.body['messages'] as Array<{ role: string; content: unknown }>;
    const pdfMessages = pdfRequest?.body['messages'] as Array<{ role: string; content: unknown }>;
    assert.equal(imageMessages[0]?.role, 'system');
    assert.equal(imageMessages[1]?.role, 'user');
    assert.equal(pdfMessages[0]?.role, 'system');
    assert.equal(pdfMessages[1]?.role, 'user');

    const serializedImageContent = JSON.stringify(imageMessages[1]?.content);
    assert.match(serializedImageContent, /Numbered OCR transcription/u);
    assert.match(serializedImageContent, /1: ALCAMPO ALMERIA/u);
    assert.doesNotMatch(serializedImageContent, /data:/u);
    assert.deepEqual(imageRequest?.files.map(({ name, type }) => ({ name, type })), [{ name: 'alcampo-page-1.png', type: 'image/png' }]);
    assert.deepEqual([...imageRequest?.files[0]!.bytes ?? []], [0x89, 0x50, 0x4e, 0x47, 0x00]);

    const serializedPdfContent = JSON.stringify(pdfMessages[1]?.content);
    assert.match(serializedPdfContent, /Numbered OCR transcription/u);
    assert.match(serializedPdfContent, /1: ALCAMPO ALMERIA/u);
    assert.doesNotMatch(serializedPdfContent, /data:/u);
    assert.deepEqual(pdfRequest?.files.map(({ name, type }) => ({ name, type })), [{ name: 'alcampo-page-1.pdf', type: 'application/pdf' }]);
    assert.match(pdfRequest?.files[0]!.bytes.toString('utf8') ?? '', /^%PDF-1\.4/u);

    assert.doesNotMatch(JSON.stringify([imageMessages, pdfMessages]), /storageKey/u);
    assert.doesNotMatch(JSON.stringify([imageMessages, pdfMessages]), new RegExp(apiKey, 'u'));

    for (const request of requests) {
      const responseFormat = request.body['response_format'] as {
        type?: string;
        json_schema?: { strict?: boolean; schema?: { required?: string[] } };
      };
      assert.equal(responseFormat.type, 'json_schema');
      assert.equal(responseFormat.json_schema?.strict, true);
      assert.ok(responseFormat.json_schema?.schema?.required?.includes('correctedText'));
      assert.ok(responseFormat.json_schema?.schema?.required?.includes('items'));
    }

    for (const [extraction, expectedStorageKey] of [
      [imageExtraction, image.storageKey],
      [pdfExtraction, pdf.storageKey],
    ] as const) {
      assert.equal(extraction.final.retailerName, 'ALCAMPO ALMERIA');
      assert.equal(extraction.final.declaredTotalMinor, 20_226);
      assert.equal(extraction.final.articleCount, 88);
      const item = extraction.final.items[0];
      assert.ok(item);
      const { captureStorageKey, fieldConfidence, sourceRegion, ...businessFields } = item;
      assert.deepEqual(businessFields, {
        description: 'C.LADRON MANZAN',
        quantity: 6,
        unitPriceMinor: 89,
        lineTotalMinor: 534,
        taxCategory: 'A',
        confidence: 0.94,
        sourceLines: [2, 3],
      });
      assert.equal(captureStorageKey, expectedStorageKey);
      assert.equal(fieldConfidence, undefined);
      assert.equal(sourceRegion, undefined);
    }
  } finally {
    service.dispose();
    provider.dispose();
    await new Promise<void>((resolve, reject) => providerServer.close((error) => error ? reject(error) : resolve()));
    rmSync(root, { recursive: true, force: true });
  }
});
