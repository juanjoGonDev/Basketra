import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { AiProviderError, type AiProvider } from '../../src/ai/provider.ts';
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

class CountingOcrProvider implements OcrProvider {
  readonly name = 'counting-ocr';
  calls = 0;
  failWhenCalled = false;

  async recognize(_input: OcrInput, signal?: AbortSignal): Promise<OcrResult> {
    signal?.throwIfAborted();
    this.calls += 1;
    if (this.failWhenCalled) throw new Error('OCR_MUST_NOT_REPEAT');
    return { text: 'ALCAMPO\nTOTAL 1,20', confidence: 0.9, source: 'local-tesseract' };
  }

  dispose(): void {}
}

const unusedAiProvider = (): AiProvider => ({
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
});

test('restart after remote identity reuses persisted OCR and performs GET only', async () => {
  const root = mkdtempSync(join(tmpdir(), 'basketra-durable-runner-'));
  const dataDir = join(root, 'data');
  const fileStore = new FileStore(join(dataDir, 'files'), join(root, 'tmp'), 1024 * 1024);
  const stored = fileStore.storeBase64({
    base64: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00]).toString('base64'),
    mimeType: 'image/png',
    originalName: 'ticket.png',
  });
  const clock = () => new Date('2026-08-28T12:00:00.000Z');
  const database = new BasketraDatabase(join(dataDir, 'basketra.db'), { clock });
  const job = database.createReceiptExtractionJob({
    captures: [{ storageKey: stored.storageKey, originalName: 'ticket.png' }],
    verifyWithAi: true,
  });
  const durableStore = new ReceiptDurableJobStore(database.path, { clock });
  const ocr = new CountingOcrProvider();
  const extraction = new ReceiptExtractionService(fileStore, unusedAiProvider, 0, ocr);
  const abort = new AbortController();
  let creates = 0;
  let gets = 0;
  const firstTransport = {
    async create(): Promise<ReceiptRemoteResponse> {
      creates += 1;
      abort.abort(new Error('SIMULATED_PROCESS_STOP'));
      return { id: 'resp_1234567', status: 'queued' };
    },
    async get(): Promise<ReceiptRemoteResponse> {
      gets += 1;
      throw new Error('GET_MUST_WAIT_FOR_RESTART');
    },
    async cancel(): Promise<ReceiptRemoteResponse> {
      throw new Error('CANCEL_MUST_NOT_RUN');
    },
  };
  const firstRunner = new ReceiptDurableExtractionRunner({
    durableStore,
    extractionService: extraction,
    fileStore,
    responses: firstTransport,
    now: clock,
    retryDelay: async () => {},
  });

  try {
    await assert.rejects(
      firstRunner.run(job, abort.signal),
      (error: unknown) => error instanceof Error && error.name === 'AbortError',
    );
    assert.equal(ocr.calls, 1);
    assert.equal(creates, 1);
    assert.equal(gets, 0);
    const interruptedState = durableStore.get(job.id);
    assert.equal(interruptedState?.pages[0]?.responseId, 'resp_1234567');
    const originalDeadline = interruptedState?.deadlineAt;
    assert.ok(originalDeadline);

    ocr.failWhenCalled = true;
    const secondTransport = {
      async create(): Promise<ReceiptRemoteResponse> {
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
    };
    const resumedRunner = new ReceiptDurableExtractionRunner({
      durableStore,
      extractionService: extraction,
      fileStore,
      responses: secondTransport,
      now: clock,
      retryDelay: async () => {},
    });
    const result = await resumedRunner.run(job);
    assert.equal(result.final.retailerName, 'ALCAMPO');
    assert.equal(ocr.calls, 1);
    assert.equal(creates, 1);
    assert.equal(gets, 1);
    assert.equal(durableStore.get(job.id)?.deadlineAt, originalDeadline);
    assert.equal(durableStore.get(job.id)?.phase, 'completed');
  } finally {
    extraction.dispose();
    durableStore.close();
    database.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('lost create response retries the identical persisted idempotency key', async () => {
  const root = mkdtempSync(join(tmpdir(), 'basketra-durable-create-'));
  const dataDir = join(root, 'data');
  const fileStore = new FileStore(join(dataDir, 'files'), join(root, 'tmp'), 1024 * 1024);
  const stored = fileStore.storeBase64({
    base64: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00]).toString('base64'),
    mimeType: 'image/png',
  });
  const clock = () => new Date('2026-08-28T12:00:00.000Z');
  const database = new BasketraDatabase(join(dataDir, 'basketra.db'), { clock });
  const job = database.createReceiptExtractionJob({
    captures: [{ storageKey: stored.storageKey }],
    verifyWithAi: true,
  });
  const durableStore = new ReceiptDurableJobStore(database.path, { clock });
  const ocr = new CountingOcrProvider();
  const extraction = new ReceiptExtractionService(fileStore, unusedAiProvider, 0, ocr);
  const keys: string[] = [];
  let createAttempts = 0;
  const transport = {
    async create(input: { idempotencyKey: string }): Promise<ReceiptRemoteResponse> {
      keys.push(input.idempotencyKey);
      createAttempts += 1;
      if (createAttempts === 1) throw new AiProviderError('AI_UNREACHABLE', { retryable: true });
      return { id: 'resp_7654321', status: 'queued' };
    },
    async get(responseId: string): Promise<ReceiptRemoteResponse> {
      return { id: responseId, status: 'completed', interpretation };
    },
    async cancel(): Promise<ReceiptRemoteResponse> {
      throw new Error('CANCEL_MUST_NOT_RUN');
    },
  };
  const runner = new ReceiptDurableExtractionRunner({
    durableStore,
    extractionService: extraction,
    fileStore,
    responses: transport,
    now: clock,
    retryDelay: async () => {},
  });

  try {
    await runner.run(job);
    assert.equal(ocr.calls, 1);
    assert.equal(createAttempts, 2);
    assert.equal(keys.length, 2);
    assert.equal(keys[0], keys[1]);
    assert.equal(keys[0], `basketra-receipt:${job.id}:g1:p0`);
    assert.equal(durableStore.get(job.id)?.pages[0]?.responseId, 'resp_7654321');
  } finally {
    extraction.dispose();
    durableStore.close();
    database.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('explicit cancellation cancels only persisted active remote responses', async () => {
  const root = mkdtempSync(join(tmpdir(), 'basketra-durable-cancel-'));
  const dataDir = join(root, 'data');
  const fileStore = new FileStore(join(dataDir, 'files'), join(root, 'tmp'), 1024 * 1024);
  const database = new BasketraDatabase(join(dataDir, 'basketra.db'));
  const job = database.createReceiptExtractionJob({
    captures: [{ storageKey: `${'a'.repeat(64)}.png` }],
    verifyWithAi: true,
  });
  const durableStore = new ReceiptDurableJobStore(database.path);
  durableStore.initialize(job.id, {
    deadlineAt: new Date(Date.now() + 60_000).toISOString(),
    generation: 1,
    pageCount: 1,
  });
  durableStore.saveRemoteIdentity(job.id, 0, {
    responseId: 'resp_1234567',
    status: 'in_progress',
  });
  durableStore.markPhase(job.id, 'ai_running');
  const calls: string[] = [];
  const runner = new ReceiptDurableExtractionRunner({
    durableStore,
    extractionService: new ReceiptExtractionService(fileStore, unusedAiProvider, 0),
    fileStore,
    responses: {
      async create(): Promise<ReceiptRemoteResponse> {
        calls.push('create');
        throw new Error('CREATE_MUST_NOT_RUN');
      },
      async get(): Promise<ReceiptRemoteResponse> {
        calls.push('get');
        throw new Error('GET_MUST_NOT_RUN');
      },
      async cancel(responseId: string): Promise<ReceiptRemoteResponse> {
        calls.push(`cancel:${responseId}`);
        return { id: responseId, status: 'cancelled', errorCode: 'response_cancelled' };
      },
    },
  });

  try {
    await runner.cancel(job.id);
    assert.deepEqual(calls, ['cancel:resp_1234567']);
    const page = durableStore.get(job.id)?.pages[0];
    assert.equal(page?.responseId, 'resp_1234567');
    assert.equal(page?.remoteStatus, 'cancelled');
    assert.equal(page?.remoteErrorCode, 'RESPONSE_CANCELLED');
    assert.equal(durableStore.get(job.id)?.phase, 'cancelled');
  } finally {
    durableStore.close();
    database.close();
    rmSync(root, { recursive: true, force: true });
  }
});
