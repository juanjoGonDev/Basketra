import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { BasketraDatabase, CURRENT_SCHEMA_VERSION } from '../../src/infrastructure/database.ts';
import { ReceiptDurableJobStore } from '../../src/receipts/durable-job-store.ts';

const capture = {
  storageKey: `${'a'.repeat(64)}.png`,
  originalName: 'ticket.png',
};

const ocrPage = {
  position: 0,
  storageKey: capture.storageKey,
  mimeType: 'image/png',
  text: 'ALCAMPO\nTOTAL 1,20',
  confidence: 0.91,
  source: 'local-tesseract' as const,
  deterministic: {
    items: [],
    metadata: {
      retailerName: 'ALCAMPO',
      declaredTotalMinor: 120,
    },
  },
};

test('schema v6 persists receipt OCR and remote response checkpoints across store restarts', () => {
  const root = mkdtempSync(join(tmpdir(), 'basketra-durable-receipt-'));
  const databasePath = join(root, 'basketra.db');
  const deadlineAt = '2026-08-28T12:05:00.000Z';
  let now = new Date('2026-08-28T12:00:00.000Z');
  const database = new BasketraDatabase(databasePath, { clock: () => now });
  assert.equal(CURRENT_SCHEMA_VERSION, 6);
  const job = database.createReceiptExtractionJob({ captures: [capture], verifyWithAi: true });

  const store = new ReceiptDurableJobStore(database.path, { clock: () => now });
  try {
    const initialized = store.initialize(job.id, {
      deadlineAt,
      generation: 1,
      pageCount: 1,
    });
    assert.deepEqual(initialized, {
      jobId: job.id,
      generation: 1,
      phase: 'queued',
      deadlineAt,
      pageCount: 1,
    });

    store.markPhase(job.id, 'ocr_running');
    store.saveOcrPage(job.id, 0, ocrPage);
    const key = store.ensureIdempotencyKey(job.id, 0);
    assert.equal(key, `basketra-receipt:${job.id}:g1:p0`);
    store.markPhase(job.id, 'ai_pending');
    store.saveRemoteIdentity(job.id, 0, {
      responseId: 'resp_1234567',
      status: 'queued',
    });
    store.markPhase(job.id, 'ai_running');
    store.saveRemoteResult(job.id, 0, {
      responseId: 'resp_1234567',
      status: 'completed',
      interpretation: {
        currency: 'EUR',
        correctedText: 'ALCAMPO\nTOTAL 1,20',
        items: [],
        warnings: [],
      },
    });
    now = new Date('2026-08-28T12:01:00.000Z');
    store.markPhase(job.id, 'completed');
  } finally {
    store.close();
  }

  const reopened = new ReceiptDurableJobStore(database.path, { clock: () => now });
  try {
    const state = reopened.get(job.id);
    assert.equal(state?.deadlineAt, deadlineAt);
    assert.equal(state?.phase, 'completed');
    assert.equal(state?.generation, 1);
    assert.deepEqual(state?.pages[0]?.ocr, ocrPage);
    assert.equal(state?.pages[0]?.idempotencyKey, `basketra-receipt:${job.id}:g1:p0`);
    assert.equal(state?.pages[0]?.responseId, 'resp_1234567');
    assert.equal(state?.pages[0]?.remoteStatus, 'completed');
    assert.equal((state?.pages[0]?.remoteResult as { currency?: string } | undefined)?.currency, 'EUR');
  } finally {
    reopened.close();
    database.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('durable receipt state is removed with its parent job and recoverable work is discoverable', () => {
  const root = mkdtempSync(join(tmpdir(), 'basketra-durable-recovery-'));
  let now = new Date('2026-08-28T12:00:00.000Z');
  const database = new BasketraDatabase(join(root, 'basketra.db'), { clock: () => now });
  const first = database.createReceiptExtractionJob({ captures: [capture], verifyWithAi: true });
  const second = database.createReceiptExtractionJob({ captures: [capture], verifyWithAi: true });
  database.startReceiptExtractionJob(second.id);
  const store = new ReceiptDurableJobStore(database.path, { clock: () => now });

  try {
    store.initialize(first.id, {
      deadlineAt: '2026-08-28T12:05:00.000Z',
      generation: 1,
      pageCount: 1,
    });
    store.initialize(second.id, {
      deadlineAt: '2026-08-28T12:05:00.000Z',
      generation: 1,
      pageCount: 1,
    });
    store.markPhase(second.id, 'ai_pending');
    assert.deepEqual(store.listRecoverableJobIds().sort(), [first.id, second.id].sort());

    database.cancelReceiptExtractionJob(first.id);
    assert.deepEqual(store.listRecoverableJobIds(), [second.id]);

    now = new Date('2026-08-30T12:00:00.000Z');
    database.cancelReceiptExtractionJob(second.id);
    assert.equal(database.pruneReceiptExtractionJobs(now.toISOString()), 2);
    assert.equal(store.get(first.id), undefined);
    assert.equal(store.get(second.id), undefined);
  } finally {
    store.close();
    database.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('startup recovery fails only legacy active jobs without durable checkpoints', () => {
  const root = mkdtempSync(join(tmpdir(), 'basketra-durable-startup-'));
  const now = new Date('2026-08-28T12:00:00.000Z');
  const database = new BasketraDatabase(join(root, 'basketra.db'), { clock: () => now });
  const durable = database.createReceiptExtractionJob({ captures: [capture], verifyWithAi: true });
  const legacy = database.createReceiptExtractionJob({ captures: [capture], verifyWithAi: true });
  assert.equal(database.startReceiptExtractionJob(durable.id)?.status, 'running');
  assert.equal(database.startReceiptExtractionJob(legacy.id)?.status, 'running');
  const store = new ReceiptDurableJobStore(database.path, { clock: () => now });

  try {
    store.initialize(durable.id, {
      deadlineAt: '2026-08-28T12:05:00.000Z',
      generation: 1,
      pageCount: 1,
    });
    store.markPhase(durable.id, 'ai_pending');

    assert.equal(store.recoverNonDurableActiveJobs(), 1);
    assert.equal(database.getReceiptExtractionJob(durable.id)?.status, 'running');
    assert.deepEqual(store.listRecoverableJobIds(), [durable.id]);
    assert.equal(database.getReceiptExtractionJob(legacy.id)?.status, 'failed');
    assert.equal(database.getReceiptExtractionJob(legacy.id)?.errorCode, 'RECEIPT_EXTRACTION_INTERRUPTED');
  } finally {
    store.close();
    database.close();
    rmSync(root, { recursive: true, force: true });
  }
});
