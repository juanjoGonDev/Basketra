import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import type { AiProvider } from '../../src/ai/provider.ts';
import { FileStore } from '../../src/infrastructure/files.ts';
import type { OcrProvider } from '../../src/ocr/provider.ts';
import { ReceiptExtractionService } from '../../src/receipts/service.ts';

function unusedProvider(): AiProvider {
  return {
    async getCapabilities() {
      return { structuredOutput: true, jsonObject: true, image: true, pdf: true, internetSearch: false };
    },
    async testConnection() {
      return { ok: true };
    },
    async executeStructured() {
      throw new Error('AI_MUST_NOT_RUN');
    },
    dispose() {},
  };
}

function unusedOcr(): OcrProvider {
  return {
    name: 'unused-ocr',
    async recognize() {
      throw new Error('OCR_MUST_NOT_RUN');
    },
    dispose() {},
  };
}

function withService(run: (service: ReceiptExtractionService) => void): void {
  const root = mkdtempSync(join(tmpdir(), 'basketra-retry-request-'));
  const store = new FileStore(join(root, 'files'), join(root, 'tmp'), 1024 * 1024);
  const service = new ReceiptExtractionService(store, unusedProvider, 0, unusedOcr());
  try {
    run(service);
  } finally {
    service.dispose();
    rmSync(root, { recursive: true, force: true });
  }
}

const capture = { storageKey: '12345678' };
const retryOfJobId = 'receiptextractionjob_abcdef12';

test('receipt retry request preserves a valid failed-job identity', () => {
  withService((service) => {
    assert.deepEqual(service.parseRequest({
      captures: [capture],
      verifyWithAi: true,
      retryOfJobId,
    }), {
      captures: [capture],
      verifyWithAi: true,
      retryOfJobId,
    });
  });
});

test('receipt retry request rejects an invalid durable job identity', () => {
  withService((service) => {
    assert.throws(
      () => service.parseRequest({
        captures: [capture],
        verifyWithAi: true,
        retryOfJobId: 'invalid-job',
      }),
      /retry job id is invalid/u,
    );
  });
});

test('receipt retry request requires AI verification', () => {
  withService((service) => {
    assert.throws(
      () => service.parseRequest({
        captures: [capture],
        verifyWithAi: false,
        retryOfJobId,
      }),
      /retry requires AI verification/u,
    );
  });
});
