import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AiProvider } from '../../src/ai/provider.ts';
import { FileStore } from '../../src/infrastructure/files.ts';
import type { OcrProvider } from '../../src/ocr/provider.ts';
import { ReceiptExtractionService } from '../../src/receipts/service.ts';

const PNG_PREFIX = Uint8Array.from([0x89, 0x50, 0x4e, 0x47]);

test('receipt service keeps two OCR slots while serializing AI verification', async () => {
  const root = mkdtempSync(join(tmpdir(), 'basketra-receipt-concurrency-'));
  const store = new FileStore(join(root, 'files'), join(root, 'tmp'), 2 * 1024 * 1024);
  let releaseInitialOcr = (): void => {};
  const initialOcrGate = new Promise<void>((resolve) => {
    releaseInitialOcr = resolve;
  });
  let releaseFirstAi = (): void => {};
  const firstAiGate = new Promise<void>((resolve) => {
    releaseFirstAi = resolve;
  });
  let activeOcr = 0;
  let maximumOcr = 0;
  let ocrCalls = 0;
  let activeAi = 0;
  let maximumAi = 0;
  let aiCalls = 0;

  const localOcr: OcrProvider = {
    name: 'controlled-local-ocr',
    async recognize(input, signal) {
      signal?.throwIfAborted();
      assert.equal(input.mimeType, 'image/png');
      activeOcr += 1;
      maximumOcr = Math.max(maximumOcr, activeOcr);
      ocrCalls += 1;
      const call = ocrCalls;
      try {
        if (call <= 2) await initialOcrGate;
        return {
          text: `Product ${call};1;120;120`,
          confidence: 0.9,
          source: 'local-tesseract',
        };
      } finally {
        activeOcr -= 1;
      }
    },
    dispose() {},
  };

  const aiProvider: AiProvider = {
    async getCapabilities() {
      return {
        structuredOutput: true,
        jsonObject: true,
        image: true,
        pdf: true,
        internetSearch: false,
      };
    },
    async testConnection() {
      return { ok: true };
    },
    async executeStructured() {
      activeAi += 1;
      maximumAi = Math.max(maximumAi, activeAi);
      aiCalls += 1;
      const call = aiCalls;
      try {
        if (call === 1) await firstAiGate;
        return {
          currency: 'EUR',
          correctedText: `Product ${call};1;120;120`,
          items: [{
            description: `Product ${call}`,
            quantity: 1,
            unitPriceMinor: 120,
            lineTotalMinor: 120,
            confidence: 0.9,
            sourceLines: [1],
          }],
          warnings: [],
        };
      } finally {
        activeAi -= 1;
      }
    },
    dispose() {},
  };

  try {
    const captures = [1, 2, 3].map((suffix) => {
      const bytes = Buffer.concat([Buffer.from(PNG_PREFIX), Buffer.from([suffix])]);
      return store.storeBase64({
        base64: bytes.toString('base64'),
        mimeType: 'image/png',
      });
    });
    const service = new ReceiptExtractionService(store, () => aiProvider, 0, localOcr);
    const extraction = service.extract(service.parseRequest({
      captures: captures.map((capture) => ({ storageKey: capture.storageKey })),
      verifyWithAi: true,
    }));

    await waitFor(() => ocrCalls === 2);
    assert.equal(maximumOcr, 2);
    releaseInitialOcr();
    await waitFor(() => aiCalls === 1 && ocrCalls === 3);
    assert.equal(maximumAi, 1);
    releaseFirstAi();

    const result = await extraction;
    assert.equal(result.pages.length, 3);
    assert.equal(aiCalls, 3);
    assert.equal(maximumAi, 1);
    assert.equal(maximumOcr, 2);
    service.dispose();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  throw new Error('Condition was not reached');
}
