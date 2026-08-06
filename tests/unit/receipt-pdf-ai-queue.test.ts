import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import type { AiProvider } from '../../src/ai/provider.ts';
import { FileStore } from '../../src/infrastructure/files.ts';
import type { OcrProvider } from '../../src/ocr/provider.ts';
import { ReceiptExtractionService } from '../../src/receipts/service.ts';

function pdfBytes(index: number): Buffer {
  return Buffer.from(`%PDF-1.4\n% fixture ${index}\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF`);
}

test('PDF OCR reuses one multimodal provider and serializes work through the canonical AI queue', async () => {
  const root = mkdtempSync(join(tmpdir(), 'basketra-pdf-ai-queue-'));
  const store = new FileStore(join(root, 'files'), join(root, 'tmp'), 1024 * 1024);
  const captures = [1, 2].map(index => store.storeBase64({
    base64: pdfBytes(index).toString('base64'),
    mimeType: 'application/pdf',
    originalName: `receipt-${index}.pdf`,
  }));

  let providerFactoryCalls = 0;
  let activeAi = 0;
  let maximumAi = 0;
  let aiCalls = 0;
  let releaseFirst = (): void => {};
  const firstGate = new Promise<void>(resolve => {
    releaseFirst = resolve;
  });
  const observedFileNames: string[] = [];

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
    async executeStructured(input) {
      activeAi += 1;
      maximumAi = Math.max(maximumAi, activeAi);
      aiCalls += 1;
      const call = aiCalls;
      try {
        assert.equal(input.operation, 'receipt-ocr');
        assert.ok(Array.isArray(input.content));
        const filePart = input.content[1];
        assert.equal(filePart?.type, 'file');
        if (filePart?.type === 'file') {
          observedFileNames.push(filePart.file.filename);
          assert.match(filePart.file.file_data, /^data:application\/pdf;base64,/u);
        }
        if (call === 1) await firstGate;
        return {
          text: `PRODUCT ${call};1;150;150\nTOTAL 1,50`,
          confidence: 0.9,
        };
      } finally {
        activeAi -= 1;
      }
    },
    dispose() {},
  };

  const unusedLocalOcr: OcrProvider = {
    name: 'must-not-run',
    async recognize() {
      throw new Error('Local OCR must not process PDF input');
    },
    dispose() {},
  };

  const service = new ReceiptExtractionService(
    store,
    () => {
      providerFactoryCalls += 1;
      return aiProvider;
    },
    0,
    unusedLocalOcr,
  );

  try {
    const extraction = service.extract(service.parseRequest({
      captures: captures.map((capture, index) => ({
        storageKey: capture.storageKey,
        originalName: `receipt-${index + 1}.pdf`,
      })),
      verifyWithAi: false,
    }));

    await waitFor(() => aiCalls === 1);
    assert.equal(maximumAi, 1);
    releaseFirst();

    const result = await extraction;
    assert.equal(result.pages.length, 2);
    assert.deepEqual(result.pages.map(page => page.source), ['provider', 'provider']);
    assert.equal(aiCalls, 2);
    assert.equal(maximumAi, 1);
    assert.equal(providerFactoryCalls, 1);
    assert.deepEqual(observedFileNames.sort(), ['receipt-1.pdf', 'receipt-2.pdf']);
  } finally {
    service.dispose();
    rmSync(root, { recursive: true, force: true });
  }
});

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await new Promise(resolve => setImmediate(resolve));
  }
  throw new Error('Condition was not reached');
}
