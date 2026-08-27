import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  AiProviderError,
  type AiProvider,
  type AiStructuredInput,
} from '../../src/ai/provider.ts';
import { StructuredAiExecutor } from '../../src/ai/structured-executor.ts';
import { mapError } from '../../src/api/errors.ts';
import { FileStore } from '../../src/infrastructure/files.ts';
import type { OcrProvider } from '../../src/ocr/provider.ts';
import {
  ReceiptAiVerificationTimeoutError,
  ReceiptExtractionService,
  ReceiptPageTaskQueue,
} from '../../src/receipts/service.ts';

const SHORT_TEST_BUDGET_MS = 25;
const pngBytes = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x00]);

function capabilities() {
  return {
    structuredOutput: true,
    jsonObject: true,
    image: true,
    pdf: false,
    internetSearch: false,
  } as const;
}

function interpretedPage(description = 'Milk') {
  return {
    currency: 'EUR',
    correctedText: `${description} 1,20`,
    items: [{
      description,
      quantity: 1,
      unitPriceMinor: 120,
      lineTotalMinor: 120,
      confidence: 0.9,
      sourceLines: [1],
    }],
    warnings: [],
  };
}

function provider(executeStructured: (input: AiStructuredInput) => Promise<unknown>): AiProvider {
  return {
    async getCapabilities() {
      return capabilities();
    },
    async testConnection() {
      return { ok: true };
    },
    executeStructured,
    dispose() {},
  };
}

function localOcr(): OcrProvider {
  return {
    name: 'receipt-ai-budget-test-ocr',
    async recognize(_input, signal) {
      signal?.throwIfAborted();
      return { text: 'Milk 1,20', confidence: 1, source: 'local-tesseract' };
    },
    dispose() {},
  };
}

function serviceWithBudget(
  store: FileStore,
  aiProvider: AiProvider,
  maxRetries: number,
  budgetMs: number,
): ReceiptExtractionService {
  return new ReceiptExtractionService(
    store,
    () => aiProvider,
    maxRetries,
    localOcr(),
    new ReceiptPageTaskQueue(),
    new ReceiptPageTaskQueue(1),
    { aiVerificationBudgetMs: budgetMs },
  );
}

test('structured executor treats abort as terminal even when retries remain', async () => {
  let attempts = 0;
  const aiProvider = provider(async () => {
    attempts += 1;
    throw new DOMException('cancelled', 'AbortError');
  });
  const executor = new StructuredAiExecutor(aiProvider, 3);

  await assert.rejects(
    () => executor.execute({
      operation: 'test-abort',
      systemPrompt: 'Return JSON only.',
      content: 'test',
      schemaName: 'test_abort',
      schema: {
        jsonSchema: {
          type: 'object',
          additionalProperties: false,
          required: ['value'],
          properties: { value: { type: 'string' } },
        },
        parse(value: unknown) {
          return value;
        },
      },
    }),
    { name: 'AbortError' },
  );

  assert.equal(attempts, 1);
});

test('one receipt AI deadline spans pages and retries and aborts without replay', async () => {
  const root = mkdtempSync(join(tmpdir(), 'basketra-receipt-ai-budget-'));
  const store = new FileStore(join(root, 'files'), join(root, 'tmp'), 4096);
  try {
    const first = store.storeBase64({
      base64: Buffer.from(pngBytes).toString('base64'),
      mimeType: 'image/png',
    });
    const secondBytes = Buffer.concat([Buffer.from(pngBytes), Buffer.from([1])]);
    const second = store.storeBase64({
      base64: secondBytes.toString('base64'),
      mimeType: 'image/png',
    });
    const receivedSignals: AbortSignal[] = [];
    let providerCalls = 0;
    const aiProvider = provider(async (input) => {
      providerCalls += 1;
      assert.ok(input.signal);
      receivedSignals.push(input.signal);
      if (providerCalls === 1) return interpretedPage('Milk');
      if (providerCalls === 2) {
        throw new AiProviderError('AI_UNREACHABLE', { retryable: true });
      }
      return await new Promise<unknown>((_resolve, reject) => {
        input.signal?.addEventListener(
          'abort',
          () => reject(new DOMException('deadline', 'AbortError')),
          { once: true },
        );
      });
    });
    const service = serviceWithBudget(store, aiProvider, 3, SHORT_TEST_BUDGET_MS);

    await assert.rejects(
      () => service.extract(service.parseRequest({
        captures: [
          { storageKey: first.storageKey, embeddedText: 'Milk 1,20' },
          { storageKey: second.storageKey, embeddedText: 'Bread 1,20' },
        ],
        verifyWithAi: true,
      })),
      (error: unknown) =>
        error instanceof ReceiptAiVerificationTimeoutError &&
        error.code === 'AI_RECEIPT_TIMEOUT',
    );

    assert.equal(providerCalls, 3);
    assert.equal(receivedSignals.length, 3);
    assert.ok(receivedSignals.every((signal) => signal === receivedSignals[0]));
    assert.equal(receivedSignals[0]?.aborted, true);
    await new Promise((resolve) => setTimeout(resolve, SHORT_TEST_BUDGET_MS));
    assert.equal(providerCalls, 3);
    service.dispose();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('caller cancellation stays distinct from the receipt deadline', async () => {
  const root = mkdtempSync(join(tmpdir(), 'basketra-receipt-ai-cancel-'));
  const store = new FileStore(join(root, 'files'), join(root, 'tmp'), 4096);
  try {
    const stored = store.storeBase64({
      base64: Buffer.from(pngBytes).toString('base64'),
      mimeType: 'image/png',
    });
    let started = () => {};
    const providerStarted = new Promise<void>((resolve) => {
      started = resolve;
    });
    let providerCalls = 0;
    const aiProvider = provider(async (input) => {
      providerCalls += 1;
      assert.ok(input.signal);
      started();
      return await new Promise<unknown>((_resolve, reject) => {
        input.signal?.addEventListener(
          'abort',
          () => reject(new DOMException('caller cancelled', 'AbortError')),
          { once: true },
        );
      });
    });
    const service = serviceWithBudget(store, aiProvider, 3, 1_000);
    const controller = new AbortController();
    const pending = service.extract(service.parseRequest({
      captures: [{ storageKey: stored.storageKey, embeddedText: 'Milk 1,20' }],
      verifyWithAi: true,
    }), controller.signal);

    await providerStarted;
    controller.abort();

    await assert.rejects(
      () => pending,
      (error: unknown) =>
        error instanceof Error &&
        error.name === 'AbortError' &&
        !(error instanceof ReceiptAiVerificationTimeoutError),
    );
    assert.equal(providerCalls, 1);
    service.dispose();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('receipt AI deadline maps to a stable redacted 504 error', () => {
  const mapped = mapError(new ReceiptAiVerificationTimeoutError());

  assert.equal(mapped.status, 504);
  assert.equal(mapped.code, 'AI_RECEIPT_TIMEOUT');
  assert.match(mapped.message, /cinco minutos/u);
  assert.doesNotMatch(mapped.message, /provider|body|OCR text|path/u);
});
