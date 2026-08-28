import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';

import { BasketraServer } from '../../src/api/server.ts';
import type { AppConfig } from '../../src/infrastructure/config.ts';
import { BasketraDatabase } from '../../src/infrastructure/database.ts';
import { FileStore } from '../../src/infrastructure/files.ts';
import { ReceiptDurableJobStore } from '../../src/receipts/durable-job-store.ts';

function config(root: string): AppConfig {
  return {
    host: '127.0.0.1',
    port: 0,
    dataDir: join(root, 'data'),
    tempDir: join(root, 'tmp'),
    maxBodyBytes: 8 * 1024 * 1024,
    aiTimeoutMs: 1_000,
    aiMaxRetries: 0,
    aiImageCapability: true,
    aiPdfCapability: false,
    overpassBaseUrl: 'http://127.0.0.1:9/api/',
    idleHibernateAfterMs: 0,
    idleExitAfterMs: 0,
  };
}

test('explicit failed-job retry creates a new durable job seeded from server OCR', async () => {
  const root = mkdtempSync(join(tmpdir(), 'basketra-durable-retry-api-'));
  const appConfig = config(root);
  const fileStore = new FileStore(join(appConfig.dataDir, 'files'), appConfig.tempDir, appConfig.maxBodyBytes);
  const stored = fileStore.storeBase64({
    base64: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x03]).toString('base64'),
    mimeType: 'image/png',
  });
  const database = new BasketraDatabase(join(appConfig.dataDir, 'basketra.db'));
  const source = database.createReceiptExtractionJob({
    captures: [{ storageKey: stored.storageKey, originalName: 'receipt.png' }],
    verifyWithAi: true,
  });
  database.startReceiptExtractionJob(source.id);
  const durableStore = new ReceiptDurableJobStore(database.path);
  durableStore.initialize(source.id, {
    deadlineAt: new Date(Date.now() + 60_000).toISOString(),
    generation: 1,
    pageCount: 1,
  });
  durableStore.saveOcrPage(source.id, 0, {
    position: 0,
    storageKey: stored.storageKey,
    mimeType: 'image/png',
    text: 'SERVER PERSISTED OCR',
    confidence: 0.9,
    source: 'local-tesseract',
    deterministic: { items: [], metadata: {} },
  });
  durableStore.saveRemoteIdentity(source.id, 0, {
    responseId: 'resp_failedapi',
    status: 'in_progress',
  });
  durableStore.saveRemoteFailure(source.id, 0, {
    status: 'failed',
    errorCode: 'REMOTE_RESPONSE_FAILED',
  });
  durableStore.markPhase(source.id, 'failed');
  database.failReceiptExtractionJob(source.id, 'AI_PROVIDER_FAILED');
  durableStore.close();
  database.close();

  const server = new BasketraServer(appConfig);
  let retryJobId = '';
  try {
    await server.listen();
    const response = await fetch(
      `http://127.0.0.1:${server.address().port}/api/v1/receipts/extraction-jobs/${encodeURIComponent(source.id)}/retry-ai`,
      { method: 'POST' },
    );
    assert.equal(response.status, 202);
    const body = await response.json() as {
      job: { id: string };
      retryOf: string;
    };
    retryJobId = body.job.id;
    assert.notEqual(retryJobId, source.id);
    assert.equal(body.retryOf, source.id);
  } finally {
    await server.close();
  }

  const verificationStore = new ReceiptDurableJobStore(join(appConfig.dataDir, 'basketra.db'));
  try {
    const retryState = verificationStore.get(retryJobId);
    assert.equal(retryState?.pages[0]?.ocr?.text, 'SERVER PERSISTED OCR');
    assert.equal(retryState?.pages[0]?.responseId, undefined);
    assert.equal(retryState?.pages[0]?.idempotencyKey?.includes(retryJobId), true);
    assert.equal(retryState?.pages[0]?.idempotencyKey?.includes(source.id), false);
  } finally {
    verificationStore.close();
    rmSync(root, { recursive: true, force: true });
  }
});
