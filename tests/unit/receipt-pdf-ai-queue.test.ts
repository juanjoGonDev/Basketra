import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import type { AiProvider } from '../../src/ai/provider.ts';
import { FileStore } from '../../src/infrastructure/files.ts';
import type { OcrProvider } from '../../src/ocr/provider.ts';
import { ReceiptExtractionService } from '../../src/receipts/service.ts';

test('PDFs create direct AI evidence instead of entering an OCR provider queue', () => {
  const root = mkdtempSync(join(tmpdir(), 'basketra-pdf-direct-evidence-'));
  const store = new FileStore(join(root, 'files'), join(root, 'tmp'), 1024 * 1024);
  const stored = store.storeBase64({
    base64: Buffer.from('%PDF-1.4\nfixture').toString('base64'),
    mimeType: 'application/pdf',
    originalName: 'receipt.pdf',
  });
  let localOcrCalls = 0;
  const localOcr: OcrProvider = {
    name: 'must-not-run',
    async recognize() {
      localOcrCalls += 1;
      throw new Error('OCR must not process PDF input');
    },
    dispose() {},
  };
  const providerFactory = (): AiProvider => {
    throw new Error('The durable responses client owns PDF AI validation');
  };
  const service = new ReceiptExtractionService(store, providerFactory, 0, localOcr);

  try {
    const evidence = service.preparePdfForDirectVerification({
      storageKey: stored.storageKey,
      originalName: 'receipt.pdf',
      embeddedText: 'Legacy OCR must not alter direct PDF validation',
    }, 0);

    assert.deepEqual(evidence, {
      position: 0,
      storageKey: stored.storageKey,
      mimeType: 'application/pdf',
      text: '',
      confidence: 0,
      source: 'provider',
      deterministic: { items: [], metadata: {} },
    });
    assert.equal(localOcrCalls, 0);
  } finally {
    service.dispose();
    rmSync(root, { recursive: true, force: true });
  }
});
