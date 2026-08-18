import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { AiProvider } from '../../src/ai/provider.ts';
import { FileStore } from '../../src/infrastructure/files.ts';
import type { OcrLine, OcrProvider } from '../../src/ocr/provider.ts';
import { ReceiptExtractionService } from '../../src/receipts/service.ts';

function provider(executeStructured: AiProvider['executeStructured']): AiProvider {
  return {
    async getCapabilities() {
      return {
        structuredOutput: true,
        jsonObject: true,
        image: true,
        pdf: false,
        internetSearch: false,
      };
    },
    async testConnection() {
      return { ok: true };
    },
    executeStructured,
    dispose() {},
  };
}

function ocrWithLines(lines?: readonly OcrLine[]): OcrProvider {
  return {
    name: 'test-local-ocr',
    async recognize(_input, signal) {
      signal?.throwIfAborted();
      return {
        text: 'LECHE 1,20\nTOTAL 1,20',
        confidence: 0.94,
        source: 'local-tesseract',
        ...(lines ? { lines } : {}),
      };
    },
    dispose() {},
  };
}

function localOcr(): OcrProvider {
  return ocrWithLines([
    {
      index: 1,
      text: 'LECHE 1,20',
      confidence: 0.93,
      region: { x: 0.1, y: 0.2, width: 0.7, height: 0.05 },
    },
    {
      index: 2,
      text: 'TOTAL 1,20',
      confidence: 0.96,
      region: { x: 0.55, y: 0.9, width: 0.3, height: 0.04 },
    },
  ]);
}

function successfulInterpretation() {
  return {
    currency: 'EUR',
    correctedText: 'Leche 1,20',
    items: [{
      description: 'Leche',
      quantity: 1,
      unitPriceMinor: 120,
      lineTotalMinor: 120,
      confidence: 0.97,
      sourceLines: [1],
    }],
    warnings: [],
  };
}

async function withService(
  aiProvider: AiProvider,
  run: (service: ReceiptExtractionService, captures: readonly { storageKey: string }[]) => Promise<void>,
  ocrProvider: OcrProvider = localOcr(),
): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), 'basketra-ocr-warning-'));
  const store = new FileStore(join(root, 'files'), join(root, 'tmp'), 1024 * 1024);
  const first = store.storeBase64({
    base64: Buffer.from([0x89, 0x50, 0x4e, 0x47, 1]).toString('base64'),
    mimeType: 'image/png',
  });
  const second = store.storeBase64({
    base64: Buffer.from([0x89, 0x50, 0x4e, 0x47, 2]).toString('base64'),
    mimeType: 'image/png',
  });
  const service = new ReceiptExtractionService(store, () => aiProvider, 0, ocrProvider);
  try {
    await run(service, [first, second]);
  } finally {
    service.dispose();
    rmSync(root, { recursive: true, force: true });
  }
}

test('AI verification failure keeps deterministic OCR items as a completed usable result', async () => {
  await withService(provider(async () => {
    throw new Error('AI_UNREACHABLE');
  }), async (service, captures) => {
    const result = await service.extract({
      captures: [captures[0]!],
      verifyWithAi: true,
    });

    assert.equal(result.pages[0]?.ai, undefined);
    assert.deepEqual(result.pages[0]?.aiFailure, { code: 'AI_UNREACHABLE' });
    assert.equal(result.final.items.length, 1);
    assert.equal(result.final.items[0]?.description, 'LECHE');
    assert.equal(result.final.items[0]?.captureStorageKey, captures[0]?.storageKey);
    const region = result.final.items[0]?.sourceRegion;
    assert.ok(region);
    assert.equal(region.x, 0.1);
    assert.equal(region.y, 0.2);
    assert.equal(region.width, 0.7);
    assert.ok(Math.abs(region.height - 0.05) < 1e-12);
    assert.equal(result.final.warnings.includes('AI verification unavailable for one receipt page'), true);
  });
});

test('mixed receipt pages keep AI success and OCR fallback independently', async () => {
  let calls = 0;
  await withService(provider(async () => {
    calls += 1;
    if (calls === 1) return successfulInterpretation();
    throw new Error('AI_TIMEOUT');
  }), async (service, captures) => {
    const result = await service.extract({ captures, verifyWithAi: true });
    assert.equal(result.pages[0]?.ai?.interpretation.items[0]?.description, 'Leche');
    assert.deepEqual(result.pages[1]?.aiFailure, { code: 'AI_TIMEOUT' });
    assert.equal(result.final.items.length, 2);
    assert.equal(result.final.items[0]?.description, 'Leche');
    assert.equal(result.final.items[1]?.description, 'LECHE');
    assert.equal(result.final.items[0]?.captureStorageKey, captures[0]?.storageKey);
    assert.equal(result.final.items[1]?.captureStorageKey, captures[1]?.storageKey);
  });
});

test('AI abort remains cancellation instead of being downgraded to a warning', async () => {
  await withService(provider(async () => {
    throw new DOMException('cancelled', 'AbortError');
  }), async (service, captures) => {
    await assert.rejects(
      () => service.extract({ captures: [captures[0]!], verifyWithAi: true }),
      { name: 'AbortError' },
    );
  });
});

test('AI warning preserves only bounded stable error codes', async () => {
  await withService(provider(async () => {
    throw Object.assign(new Error('ignored'), { code: 'AI_RATE_LIMIT' });
  }), async (service, captures) => {
    const result = await service.extract({ captures: [captures[0]!], verifyWithAi: true });
    assert.deepEqual(result.pages[0]?.aiFailure, { code: 'AI_RATE_LIMIT' });
  });

  await withService(provider(async () => {
    throw Object.assign(new Error('AI_FALLBACK'), { code: 'unsafe-code' });
  }), async (service, captures) => {
    const result = await service.extract({ captures: [captures[0]!], verifyWithAi: true });
    assert.deepEqual(result.pages[0]?.aiFailure, { code: 'AI_FALLBACK' });
  });

  await withService(provider(async () => {
    throw new Error('provider exploded');
  }), async (service, captures) => {
    const result = await service.extract({ captures: [captures[0]!], verifyWithAi: true });
    assert.deepEqual(result.pages[0]?.aiFailure, { code: 'AI_VERIFICATION_FAILED' });
  });
});

test('page provenance tolerates partial OCR layout and normalizes invalid line confidence', async () => {
  const lines: readonly OcrLine[] = [
    {
      index: 1,
      text: '6 x ,89',
      confidence: Number.NaN,
    },
    {
      index: 2,
      text: 'MANZANAS 5,34 A',
      confidence: 0.88,
      region: { x: 0.2, y: 0.3, width: 0.6, height: 0.08 },
    },
  ];
  await withService(provider(async () => ({
    currency: 'EUR',
    correctedText: '6 x ,89\nMANZANAS 5,34 A',
    items: [{
      description: 'Manzanas',
      quantity: 6,
      unitPriceMinor: 89,
      lineTotalMinor: 534,
      confidence: 0.97,
      sourceLines: [1, 2, 999],
    }],
    warnings: [],
  })), async (service, captures) => {
    const result = await service.extract({ captures: [captures[0]!], verifyWithAi: true });
    const item = result.final.items[0];
    assert.ok(item);
    assert.equal(item.captureStorageKey, captures[0]?.storageKey);
    assert.deepEqual(item.sourceRegion, { x: 0.2, y: 0.3, width: 0.6, height: 0.08 });
    assert.deepEqual(item.fieldConfidence, {
      description: 0.88,
      quantity: 0,
      unitPriceMinor: 0,
      lineTotalMinor: 0.88,
    });
  }, ocrWithLines(lines));
});
