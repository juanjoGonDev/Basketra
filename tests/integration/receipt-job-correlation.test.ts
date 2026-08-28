import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';

import { BasketraServer } from '../../src/api/server.ts';
import { BasketraDatabase } from '../../src/infrastructure/database.ts';
import type { AppConfig } from '../../src/infrastructure/config.ts';
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

test('receipt job response exposes persisted webApi response identities without receipt content', async () => {
  const root = mkdtempSync(join(tmpdir(), 'basketra-receipt-correlation-'));
  const appConfig = config(root);
  const database = new BasketraDatabase(join(appConfig.dataDir, 'basketra.db'));
  const capture = { storageKey: `${'a'.repeat(64)}.png` };
  const job = database.createReceiptExtractionJob({ captures: [capture], verifyWithAi: true });
  database.startReceiptExtractionJob(job.id);
  const durableStore = new ReceiptDurableJobStore(database.path);
  durableStore.initialize(job.id, {
    deadlineAt: new Date(Date.now() + 60_000).toISOString(),
    generation: 1,
    pageCount: 1,
  });
  durableStore.saveOcrPage(job.id, 0, {
    position: 0,
    storageKey: capture.storageKey,
    mimeType: 'image/png',
    text: 'PRIVATE RECEIPT TEXT',
    confidence: 0.9,
    source: 'local-tesseract',
    deterministic: { items: [], metadata: {} },
  });
  durableStore.saveRemoteIdentity(job.id, 0, {
    responseId: 'resp_1234567',
    status: 'in_progress',
  });
  durableStore.markPhase(job.id, 'failed');
  database.failReceiptExtractionJob(job.id, 'AI_PROVIDER_FAILED');
  durableStore.close();
  database.close();

  const server = new BasketraServer(appConfig);
  try {
    await server.listen();
    const response = await fetch(
      `http://127.0.0.1:${server.address().port}/api/v1/receipts/extraction-jobs/${encodeURIComponent(job.id)}`,
    );
    assert.equal(response.status, 200);
    const body = await response.json() as {
      job: { id: string; webApiResponseIds?: string[] };
    };

    assert.equal(body.job.id, job.id);
    assert.deepEqual(body.job.webApiResponseIds, ['resp_1234567']);
    assert.doesNotMatch(JSON.stringify(body), /PRIVATE RECEIPT TEXT/u);
  } finally {
    await server.close();
    rmSync(root, { recursive: true, force: true });
  }
});
