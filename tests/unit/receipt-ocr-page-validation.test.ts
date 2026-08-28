import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { FileStore } from '../../src/infrastructure/files.ts';
import type { OcrProvider } from '../../src/ocr/provider.ts';
import { ReceiptExtractionService } from '../../src/receipts/service.ts';

const unusedOcr: OcrProvider = {
  name: 'unused-test-ocr',
  async recognize() {
    throw new Error('OCR must not run for an invalid page position');
  },
  dispose() {},
};

test('receipt OCR page extraction rejects every invalid position boundary before scheduling work', async () => {
  const root = mkdtempSync(join(tmpdir(), 'basketra-receipt-page-position-'));
  const store = new FileStore(join(root, 'files'), join(root, 'tmp'), 1024);
  const service = new ReceiptExtractionService(
    store,
    () => {
      throw new Error('AI provider must not be created for an invalid page position');
    },
    0,
    unusedOcr,
  );
  const capture = { storageKey: `${'a'.repeat(64)}.png` };

  try {
    await assert.rejects(() => service.extractOcrPage(capture, Number.NaN), /position is invalid/u);
    await assert.rejects(() => service.extractOcrPage(capture, -1), /position is invalid/u);
    await assert.rejects(() => service.extractOcrPage(capture, 20), /position is invalid/u);
  } finally {
    service.dispose();
    rmSync(root, { recursive: true, force: true });
  }
});
