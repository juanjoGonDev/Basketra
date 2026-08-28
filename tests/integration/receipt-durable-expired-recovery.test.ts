import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import type { AiProvider } from '../../src/ai/provider.ts';
import { BasketraDatabase } from '../../src/infrastructure/database.ts';
import { FileStore } from '../../src/infrastructure/files.ts';
import type { OcrInput, OcrProvider, OcrResult } from '../../src/ocr/provider.ts';
import { ReceiptDurableJobStore } from '../../src/receipts/durable-job-store.ts';
import { ReceiptDurableExtractionRunner } from '../../src/receipts/durable-runner.ts';
import type { ReceiptRemoteResponse } from '../../src/receipts/responses-client.ts';
import { ReceiptExtractionService } from '../../src/receipts/service.ts';

const interpretation = {
  retailerName: 'ALCAMPO',
  declaredTotalMinor: 120,
  currency: 'EUR' as const,
  correctedText: 'ALCAMPO\nTOTAL 1,20',
  items: [],
  warnings: [],
};

class FailIfCalledOcr implements OcrProvider {
  readonly name = 'fail-if-called-ocr';
  calls = 0;

  async recognize(_input: OcrInput, _signal?: AbortSignal): Promise<OcrResult> {
    this.calls += 1;
    throw new Error('OCR_MUST_NOT_REPEAT');
  }

  dispose(): void {}
}

function unusedAiProvider(): AiProvider {
  return {
    async getCapabilities() {
      return { structuredOutput: true, jsonObject: true, image: true, pdf: true, internetSearch: false };
    },
    async testConnection() {
      return { ok: true };
    },
    async executeStructured() {
      throw new Error('SYNCHRONOUS_AI_MUST_NOT_RUN');
    },
    dispose() {},
  };
}

test('expired local deadline still reconciles a persisted remote response without OCR or POST replay', async () => {
  const root = mkdtempSync(join(tmpdir(), 'basketra-expired-durable-recovery-'));
  const databasePath = join(root, 'basketra.db');
  const fileStore = new FileStore(join(root, 'files'), join(root, 'tmp'), 1024 * 1024);
  const stored = fileStore.storeBase64({
    base64: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00]).toString('base64'),
    mimeType: 'image/png',
  });
  const createdAt = new Date('2026-08-28T12:00:00.000Z');
  const now = new Date('2026-08-28T12:10:00.000Z');
  const database = new BasketraDatabase(databasePath, { clock: () => createdAt });
  const job = database.createReceiptExtractionJob({
    captures: [{ storageKey: stored.storageKey }],
    verifyWithAi: true,
  });
  const durableStore = new ReceiptDurableJobStore(database.path, { clock: () => now });
  durableStore.initialize(job.id, {
    deadlineAt: '2026-08-28T12:05:00.000Z',
    generation: 1,
    pageCount: 1,
  });
  durableStore.saveOcrPage(job.id, 0, {
    position: 0,
    storageKey: stored.storageKey,
    mimeType: 'image/png',
    text: 'ALCAMPO\nTOTAL 1,20',
    confidence: 0.91,
    source: 'local-tesseract',
    deterministic: {
      items: [],
      metadata: { retailerName: 'ALCAMPO', declaredTotalMinor: 120 },
    },
  });
  durableStore.saveRemoteIdentity(job.id, 0, {
    responseId: 'resp_1234567',
    status: 'in_progress',
  });
  durableStore.markPhase(job.id, 'ai_running');

  const ocr = new FailIfCalledOcr();
  const extractionService = new ReceiptExtractionService(
    fileStore,
    unusedAiProvider,
    0,
    ocr,
  );
  let creates = 0;
  let gets = 0;
  const runner = new ReceiptDurableExtractionRunner({
    durableStore,
    extractionService,
    fileStore,
    responses: {
      async create(): Promise<ReceiptRemoteResponse> {
        creates += 1;
        throw new Error('CREATE_MUST_NOT_REPEAT');
      },
      async get(responseId: string): Promise<ReceiptRemoteResponse> {
        gets += 1;
        assert.equal(responseId, 'resp_1234567');
        return { id: responseId, status: 'completed', interpretation };
      },
      async cancel(): Promise<ReceiptRemoteResponse> {
        throw new Error('CANCEL_MUST_NOT_RUN');
      },
    },
    now: () => now,
    retryDelay: async () => {},
  });

  try {
    const result = await runner.run(job);
    assert.equal(result.final.retailerName, 'ALCAMPO');
    assert.equal(ocr.calls, 0);
    assert.equal(creates, 0);
    assert.equal(gets, 1);
    assert.equal(durableStore.get(job.id)?.phase, 'completed');
  } finally {
    extractionService.dispose();
    durableStore.close();
    database.close();
    rmSync(root, { recursive: true, force: true });
  }
});
