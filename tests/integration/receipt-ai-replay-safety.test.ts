import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { AiProviderError, OpenAiCompatibleProvider } from '../../src/ai/provider.ts';
import { FileStore } from '../../src/infrastructure/files.ts';
import { ReceiptExtractionService } from '../../src/receipts/service.ts';

const pngBase64 = Buffer.from(
  Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x00]),
).toString('base64');
const ocrText = [
  'ALCAMPO ALMERIA',
  '6 x ,89',
  'C.LADRON MANZAN 5,34 A',
  'TOT 202,26',
  'NUM. TOTAL ART. VENDIDOS = 88',
].join('\n');

test('receipt extraction never replays the original image after downstream progress', async () => {
  const root = mkdtempSync(join(tmpdir(), 'basketra-replay-safety-'));
  let providerError: unknown;
  let completionPosts = 0;
  let attachmentPosts = 0;

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
      completionPosts += 1;

      const chunks: Uint8Array[] = [];
      for await (const chunk of request) {
        chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
      }
      const contentType = request.headers['content-type'];
      assert.equal(typeof contentType, 'string');
      const form = await new Response(Buffer.concat(chunks), {
        headers: { 'content-type': contentType },
      }).formData();
      const metadata = form.get('request');
      assert.equal(typeof metadata, 'string');
      const files = form.getAll('files');
      assert.equal(files.length, 1);
      attachmentPosts += files.length > 0 ? 1 : 0;

      const body = JSON.parse(metadata) as Record<string, unknown>;
      assert.match(JSON.stringify(body['messages']), /Numbered OCR transcription/u);

      response.writeHead(502, { 'content-type': 'application/json' });
      response.end(
        JSON.stringify({
          error: {
            code: 'future_post_progress_failure',
            details: {
              originalRequestReplaySafe: false,
              retryScope: 'continuation_only',
            },
            message: 'The downstream continuation could not be completed',
          },
        }),
      );
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
  const provider = new OpenAiCompatibleProvider({
    baseUrl: new URL(`http://127.0.0.1:${address.port}/v1/`),
    model: 'gpt-5',
    capabilities: { image: true },
  });
  const service = new ReceiptExtractionService(store, () => provider, 3);

  try {
    await assert.rejects(
      () =>
        service.extract(
          service.parseRequest({
            captures: [
              {
                storageKey: image.storageKey,
                originalName: 'receipt.png',
                embeddedText: ocrText,
              },
            ],
            verifyWithAi: true,
          }),
        ),
      (error: unknown) => {
        assert.ok(error instanceof AiProviderError);
        assert.equal(error.code, 'AI_PROVIDER_FAILED');
        return true;
      },
    );

    assert.ifError(providerError);
    assert.equal(completionPosts, 1, 'original completion POST must be sent exactly once');
    assert.equal(attachmentPosts, 1, 'original attachment must be uploaded exactly once');
  } finally {
    service.dispose();
    provider.dispose();
    await new Promise<void>((resolve, reject) =>
      providerServer.close((error) => (error ? reject(error) : resolve())),
    );
    rmSync(root, { recursive: true, force: true });
  }
});
