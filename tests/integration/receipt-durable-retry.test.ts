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

const completedInterpretation = {
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

test('explicit retry copies durable OCR and completed remote results without stealing response ownership', async () => {
  const root = mkdtempSync(join(tmpdir(), 'basketra-durable-retry-'));
  const database = new BasketraDatabase(join(root, 'basketra.db'));
  const fileStore = new FileStore(join(root, 'files'), join(root, 'tmp'), 1024 * 1024);
  const firstStored = fileStore.storeBase64({
    base64: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x01]).toString('base64'),
    mimeType: 'image/png',
  });
  const secondStored = fileStore.storeBase64({
    base64: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x02]).toString('base64'),
    mimeType: 'image/png',
  });
  const input = {
    captures: [
      { storageKey: firstStored.storageKey, originalName: 'first.png' },
      { storageKey: secondStored.storageKey, originalName: 'second.png' },
    ],
    verifyWithAi: true,
  };
  const sourceJob = database.createReceiptExtractionJob(input);
  const retryJob = database.createReceiptExtractionJob({
    ...input,
    retryOfJobId: sourceJob.id,
  });
  const durableStore = new ReceiptDurableJobStore(database.path);
  const deadlineAt = new Date(Date.now() + 60_000).toISOString();

  durableStore.initialize(sourceJob.id, { deadlineAt, generation: 1, pageCount: 2 });
  durableStore.saveOcrPage(sourceJob.id, 0, {
    position: 0,
    storageKey: firstStored.storageKey,
    mimeType: 'image/png',
    text: 'ALCAMPO\nTOTAL 1,20',
    confidence: 0.91,
    source: 'local-tesseract',
    deterministic: { items: [], metadata: { retailerName: 'ALCAMPO', declaredTotalMinor: 120 } },
  });
  durableStore.saveOcrPage(sourceJob.id, 1, {
    position: 1,
    storageKey: secondStored.storageKey,
    mimeType: 'image/png',
    text: 'FAILED PAGE OCR',
    confidence: 0.82,
    source: 'local-tesseract',
    deterministic: { items: [], metadata: {} },
  });
  durableStore.saveRemoteResult(sourceJob.id, 0, {
    responseId: 'resp_completed1',
    status: 'completed',
    interpretation: completedInterpretation,
  });
  durableStore.saveRemoteIdentity(sourceJob.id, 1, {
    responseId: 'resp_failed123',
    status: 'in_progress',
  });
  durableStore.saveRemoteFailure(sourceJob.id, 1, {
    status: 'failed',
    errorCode: 'REMOTE_RESPONSE_FAILED',
  });
  durableStore.markPhase(sourceJob.id, 'failed');

  durableStore.initialize(retryJob.id, { deadlineAt, generation: 1, pageCount: 2 });
  durableStore.copyReusableRetryEvidence(
    sourceJob.id,
    retryJob.id,
    input.captures.map((capture) => capture.storageKey),
  );
  durableStore.copyReusableRetryEvidence(
    sourceJob.id,
    retryJob.id,
    input.captures.map((capture) => capture.storageKey),
  );

  const sourceAfterSeed = durableStore.get(sourceJob.id);
  const seeded = durableStore.get(retryJob.id);
  assert.equal(sourceAfterSeed?.pages[0]?.responseId, 'resp_completed1');
  assert.equal(seeded?.pages[0]?.ocr?.text, 'ALCAMPO\nTOTAL 1,20');
  assert.equal(seeded?.pages[1]?.ocr?.text, 'FAILED PAGE OCR');
  assert.equal(seeded?.pages[0]?.responseId, undefined);
  assert.equal(seeded?.pages[0]?.remoteStatus, 'completed');
  assert.deepEqual(seeded?.pages[0]?.remoteResult, completedInterpretation);
  assert.equal(seeded?.pages[1]?.responseId, undefined);
  assert.equal(seeded?.pages[1]?.remoteResult, undefined);
  assert.equal(seeded?.pages[0]?.idempotencyKey, undefined);
  assert.equal(seeded?.pages[1]?.idempotencyKey, undefined);

  const ocr = new FailIfCalledOcr();
  const extractionService = new ReceiptExtractionService(fileStore, unusedAiProvider, 0, ocr);
  let creates = 0;
  let createdIdempotencyKey = '';
  let createdPosition = -1;
  const runner = new ReceiptDurableExtractionRunner({
    durableStore,
    extractionService,
    fileStore,
    responses: {
      async create(createInput): Promise<ReceiptRemoteResponse> {
        creates += 1;
        createdIdempotencyKey = createInput.idempotencyKey;
        createdPosition = createInput.pagePosition;
        return {
          id: 'resp_retry123',
          status: 'completed',
          interpretation: {
            ...completedInterpretation,
            correctedText: 'FAILED PAGE OCR',
          },
        };
      },
      async get(): Promise<ReceiptRemoteResponse> {
        throw new Error('GET_MUST_NOT_RUN');
      },
      async cancel(): Promise<ReceiptRemoteResponse> {
        throw new Error('CANCEL_MUST_NOT_RUN');
      },
    },
    retryDelay: async () => {},
  });

  try {
    const result = await runner.run(retryJob);
    assert.equal(result.pages.length, 2);
    assert.equal(ocr.calls, 0);
    assert.equal(creates, 1);
    assert.equal(createdPosition, 1);
    assert.match(createdIdempotencyKey, new RegExp(retryJob.id, 'u'));
    assert.doesNotMatch(createdIdempotencyKey, new RegExp(sourceJob.id, 'u'));
    assert.equal(durableStore.get(retryJob.id)?.pages[0]?.responseId, undefined);
    assert.equal(durableStore.get(retryJob.id)?.pages[1]?.responseId, 'resp_retry123');
  } finally {
    extractionService.dispose();
    durableStore.close();
    database.close();
    rmSync(root, { recursive: true, force: true });
  }
});
