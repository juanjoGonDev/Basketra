import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { AiProvider, AiStructuredInput } from '../../src/ai/provider.ts';
import { FileStore } from '../../src/infrastructure/files.ts';
import { MultimodalAiOcrProvider, type OcrProvider } from '../../src/ocr/provider.ts';
import {
  buildReceiptReview,
  extractDeclaredTotalMinor,
  extractReceiptMetadata,
  mergeReceiptPageItems,
  parseDeterministicReceiptText,
  verifyReceiptWithAi,
  type ReceiptExtractionItem,
} from '../../src/receipts/extraction.ts';
import { ReceiptExtractionService, ReceiptPageTaskQueue } from '../../src/receipts/service.ts';

const pngBase64 = Buffer.from(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x00])).toString('base64');
const pdfBase64 = Buffer.from('%PDF-1.4\nfixture').toString('base64');

function provider(overrides: Partial<AiProvider> = {}): AiProvider {
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
    async executeStructured() {
      return { text: 'MILK 1 x 1,20 1,20', confidence: 0.9 };
    },
    dispose() {},
    ...overrides,
  };
}

function localOcr(text = 'Milk 1,20\nTOTAL 1,20'): OcrProvider {
  return {
    name: 'test-local-ocr',
    async recognize(input, signal) {
      signal?.throwIfAborted();
      assert.equal(input.mimeType, 'image/png');
      return { text, confidence: 0.91, source: 'local-tesseract' };
    },
    dispose() {},
  };
}

function interpretedPage(overrides: Record<string, unknown> = {}) {
  return {
    currency: 'EUR',
    correctedText: 'Milk 1,20',
    items: [{
      description: 'Milk',
      quantity: 1,
      unitPriceMinor: 120,
      lineTotalMinor: 120,
      confidence: 0.9,
      sourceLines: [1],
    }],
    warnings: [],
    ...overrides,
  };
}

function receiptItem(
  description: string,
  lineTotalMinor: number,
  overrides: Partial<ReceiptExtractionItem> = {},
): ReceiptExtractionItem {
  return {
    description,
    quantity: 1,
    unitPriceMinor: lineTotalMinor,
    lineTotalMinor,
    confidence: 1,
    sourceLines: [1],
    ...overrides,
  };
}

test('deterministic receipt parsing reconstructs quantity prefixes and tax categories', () => {
  const text = [
    '6 x ,89',
    'C.LADRON MANZAN 5,34 A',
    '2 x 1,00',
    'BOL PLASTICO 2,00 A',
    '6 x ,50',
    'VASO PLASTICO RE 3,00 A',
    '2 x 2,48',
    'MANOPLA 4,96',
    '2 x 1,64',
    'AGUA MINERAL AUC 3,28',
  ].join('\n');

  const items = parseDeterministicReceiptText(text);
  assert.deepEqual(items.map((item) => ({
    description: item.description,
    quantity: item.quantity,
    unitPriceMinor: item.unitPriceMinor,
    lineTotalMinor: item.lineTotalMinor,
    taxCategory: item.taxCategory,
    sourceLines: item.sourceLines,
  })), [
    { description: 'C.LADRON MANZAN', quantity: 6, unitPriceMinor: 89, lineTotalMinor: 534, taxCategory: 'A', sourceLines: [1, 2] },
    { description: 'BOL PLASTICO', quantity: 2, unitPriceMinor: 100, lineTotalMinor: 200, taxCategory: 'A', sourceLines: [3, 4] },
    { description: 'VASO PLASTICO RE', quantity: 6, unitPriceMinor: 50, lineTotalMinor: 300, taxCategory: 'A', sourceLines: [5, 6] },
    { description: 'MANOPLA', quantity: 2, unitPriceMinor: 248, lineTotalMinor: 496, taxCategory: undefined, sourceLines: [7, 8] },
    { description: 'AGUA MINERAL AUC', quantity: 2, unitPriceMinor: 164, lineTotalMinor: 328, taxCategory: undefined, sourceLines: [9, 10] },
  ]);
});

test('receipt metadata detects the supplied Alcampo facts', () => {
  const text = [
    'ALCAMPO ALMERIA',
    'FACTURA SIMPLIFICADA',
    'AGUA DESTILADA 1,89 A',
    'TOT 202,26',
    'NUM. TOTAL ART. VENDIDOS = 88',
  ].join('\n');
  assert.deepEqual(extractReceiptMetadata(text), {
    retailerName: 'ALCAMPO ALMERIA',
    declaredTotalMinor: 20_226,
    articleCount: 88,
  });
  assert.equal(extractDeclaredTotalMinor(text), 20_226);
});

test('deterministic receipt parsing preserves repeated purchases and delimited evidence', () => {
  const text = [
    'Milk;2;120;240;A',
    'Bread 1 x 1,50 1,50 B',
    'Rice 2,85',
    'TOTAL 6,75',
    'Milk;2;120;240;A',
  ].join('\n');
  const items = parseDeterministicReceiptText(text);
  assert.equal(items.length, 4);
  assert.deepEqual(items[0], {
    description: 'Milk',
    quantity: 2,
    unitPriceMinor: 120,
    lineTotalMinor: 240,
    taxCategory: 'A',
    confidence: 1,
    sourceLines: [1],
  });
  assert.equal(items[1]?.taxCategory, 'B');
  assert.equal(items[2]?.lineTotalMinor, 285);
  assert.equal(items[3]?.description, 'Milk');
  assert.equal(extractDeclaredTotalMinor(text), 675);
  assert.equal(extractDeclaredTotalMinor('No total'), undefined);
});

test('page assembly removes only adjacent overlap and keeps later real repeats', () => {
  const first = [
    receiptItem('Water', 100),
    receiptItem('Bread', 150),
    receiptItem('Milk', 120),
  ];
  const second = [
    receiptItem('BREAD', 150),
    receiptItem('Milk', 120),
    receiptItem('Rice', 285),
    receiptItem('Bread', 150),
  ];
  const merged = mergeReceiptPageItems([first, second]);
  assert.deepEqual(merged.map((item) => item.description), [
    'Water',
    'Bread',
    'Milk',
    'Rice',
    'Bread',
  ]);
});

test('receipt review keeps low confidence and arithmetic mismatches visible', () => {
  const review = buildReceiptReview([
    { description: 'Milk', quantity: 1, unitPriceMinor: 120, lineTotalMinor: 120, confidence: 0.7 },
    { description: 'Bread', quantity: 2, unitPriceMinor: 100, lineTotalMinor: 150, confidence: 1 },
  ], 270);
  assert.equal(review.lines[0]?.status, 'needs-review');
  assert.equal(review.lines[1]?.status, 'arithmetic-mismatch');
  assert.deepEqual(review.total, { expectedMinor: 270, differenceMinor: 0, valid: true });
  assert.equal(buildReceiptReview([], undefined).total, undefined);
});

test('receipt page queue is FIFO, bounded to two tasks and releases failed slots', async () => {
  const queue = new ReceiptPageTaskQueue(2);
  const starts: number[] = [];
  const releases: Array<() => void> = [];
  let active = 0;
  let maximum = 0;

  const tasks = [0, 1, 2, 3].map((index) => queue.run(async () => {
    starts.push(index);
    active += 1;
    maximum = Math.max(maximum, active);
    await new Promise<void>((resolve) => releases.push(resolve));
    active -= 1;
    if (index === 1) throw new Error('expected failure');
    return index;
  }));

  await waitFor(() => starts.length === 2);
  assert.deepEqual(starts, [0, 1]);
  assert.equal(maximum, 2);
  releases.shift()?.();
  releases.shift()?.();
  await waitFor(() => starts.length === 4);
  assert.deepEqual(starts, [0, 1, 2, 3]);
  releases.shift()?.();
  releases.shift()?.();
  const settled = await Promise.allSettled(tasks);
  assert.equal(settled[1]?.status, 'rejected');
  assert.equal(queue.activeCount, 0);
  assert.equal(queue.waitingCount, 0);
  queue.dispose();
});

test('receipt page queue cancels waiting work without consuming a slot', async () => {
  const queue = new ReceiptPageTaskQueue(1);
  let releaseFirst = () => {};
  const first = queue.run(async () => {
    await new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    return 'first';
  });
  const controller = new AbortController();
  const second = queue.run(async () => 'second', controller.signal);
  controller.abort();
  await assert.rejects(second, { name: 'AbortError' });
  assert.equal(queue.waitingCount, 0);
  releaseFirst();
  assert.equal(await first, 'first');
  queue.dispose();
});

test('multimodal OCR sends validated image content and enforces capabilities', async () => {
  let request: AiStructuredInput | undefined;
  const mock = provider({
    async executeStructured(input) {
      request = input;
      return { text: ' Milk ', confidence: 0.8 };
    },
  });
  const ocr = new MultimodalAiOcrProvider(mock, 0);
  const result = await ocr.recognize({ mimeType: 'image/png', bytes: Buffer.from(pngBase64, 'base64') });
  assert.deepEqual(result, { text: 'Milk', confidence: 0.8, source: 'provider' });
  assert.equal(Array.isArray(request?.content), true);
  assert.match(JSON.stringify(request?.content), /^\[.*data:image\/png;base64,/u);
  ocr.dispose();

  const noImage = new MultimodalAiOcrProvider(provider({
    async getCapabilities() {
      return { structuredOutput: true, jsonObject: true, image: false, pdf: false, internetSearch: false };
    },
  }), 0);
  await assert.rejects(
    () => noImage.recognize({ mimeType: 'image/png', bytes: new Uint8Array() }),
    /IMAGE_CAPABILITY/u,
  );
  const noPdf = new MultimodalAiOcrProvider(provider(), 0);
  await assert.rejects(
    () => noPdf.recognize({ mimeType: 'application/pdf', bytes: Buffer.from(pdfBase64, 'base64') }),
    /PDF_CAPABILITY/u,
  );
  await assert.rejects(
    () => ocr.recognize({ mimeType: 'text/plain', bytes: new Uint8Array() }),
    /Unsupported/u,
  );
});

test('AI receipt verification validates page interpretation and source lines locally', async () => {
  let input: AiStructuredInput | undefined;
  const mock = provider({
    async executeStructured(value) {
      input = value;
      return interpretedPage({ retailerName: 'ALCAMPO ALMERIA', declaredTotalMinor: 120, articleCount: 1 });
    },
  });
  const result = await verifyReceiptWithAi(mock, 0, 'Milk 1,20');
  assert.equal(result.value.items[0]?.description, 'Milk');
  assert.equal(result.value.declaredTotalMinor, 120);
  assert.equal(result.value.articleCount, 1);
  assert.equal(typeof input?.content, 'string');
  assert.match(String(input?.content), /^1: Milk 1,20$/u);
  await assert.rejects(() => verifyReceiptWithAi(provider({
    async executeStructured() {
      return { ...interpretedPage(), currency: 'USD' };
    },
  }), 0, 'x'));
  await assert.rejects(() => verifyReceiptWithAi(provider({
    async executeStructured() {
      return { ...interpretedPage(), items: [{ ...interpretedPage().items[0], sourceLines: [] }] };
    },
  }), 0, 'x'));
});

test('receipt service skips OCR and AI when embedded text is supplied', async () => {
  const root = mkdtempSync(join(tmpdir(), 'basketra-receipt-service-'));
  const store = new FileStore(join(root, 'files'), join(root, 'tmp'), 1024);
  try {
    const file = store.storeBase64({ base64: pngBase64, mimeType: 'image/png' });
    let providerCalls = 0;
    const service = new ReceiptExtractionService(
      store,
      () => {
        providerCalls += 1;
        return provider();
      },
      0,
      localOcr(),
    );
    const input = service.parseRequest({
      captures: [{ storageKey: file.storageKey, embeddedText: 'Milk;1;120;120\nTOTAL 1,20' }],
      verifyWithAi: false,
    });
    const result = await service.extract(input);
    assert.equal(providerCalls, 0);
    assert.equal(result.pages[0]?.source, 'embedded-text');
    assert.equal(result.final.review.lines[0]?.status, 'confirmed');
    assert.equal(result.final.declaredTotalMinor, 120);
    assert.equal(service.parseRequest({ captures: [{ storageKey: file.storageKey }] }).verifyWithAi, false);
    assert.throws(() => service.parseRequest({ captures: [], verifyWithAi: false }), /At least one/u);
    service.dispose();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('receipt service verifies every OCR page independently and combines adjacent overlap', async () => {
  const root = mkdtempSync(join(tmpdir(), 'basketra-receipt-pages-'));
  const store = new FileStore(join(root, 'files'), join(root, 'tmp'), 4096);
  try {
    const first = store.storeBase64({ base64: pngBase64, mimeType: 'image/png' });
    const second = store.storeBase64({ base64: pngBase64, mimeType: 'image/png' });
    const seenContent: string[] = [];
    const mock = provider({
      async executeStructured(input) {
        const content = String(input.content);
        seenContent.push(content);
        if (content.includes('ALCAMPO')) {
          return interpretedPage({
            retailerName: 'ALCAMPO ALMERIA',
            correctedText: 'Bread 1,50\nMilk 1,20',
            items: [receiptItem('Bread', 150, { sourceLines: [2] }), receiptItem('Milk', 120, { sourceLines: [3] })],
          });
        }
        return interpretedPage({
          declaredTotalMinor: 405,
          articleCount: 3,
          correctedText: 'Bread 1,50\nMilk 1,20\nRice 1,35\nTOTAL 4,05',
          items: [
            receiptItem('Bread', 150, { sourceLines: [1] }),
            receiptItem('Milk', 120, { sourceLines: [2] }),
            receiptItem('Rice', 135, { sourceLines: [3] }),
          ],
        });
      },
    });
    const service = new ReceiptExtractionService(store, () => mock, 0, localOcr());
    const result = await service.extract(service.parseRequest({
      captures: [
        { storageKey: first.storageKey, embeddedText: 'ALCAMPO ALMERIA\nBread 1,50\nMilk 1,20' },
        { storageKey: second.storageKey, embeddedText: 'Bread 1,50\nMilk 1,20\nRice 1,35\nTOTAL 4,05\nNUM. TOTAL ART. VENDIDOS = 3' },
      ],
      verifyWithAi: true,
    }));
    assert.equal(seenContent.length, 2);
    assert.ok(seenContent.every((content) => !content.includes('Rice') || !content.includes('ALCAMPO')));
    assert.equal(result.ai?.pages.length, 2);
    assert.equal(result.final.retailerName, 'ALCAMPO ALMERIA');
    assert.equal(result.final.declaredTotalMinor, 405);
    assert.equal(result.final.articleCount, 3);
    assert.deepEqual(result.final.items.map((item) => item.description), ['Bread', 'Milk', 'Rice']);
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
