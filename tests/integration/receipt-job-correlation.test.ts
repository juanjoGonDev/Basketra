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

test('receipt job response exposes persisted progressive OCR while AI remains non-terminal', async () => {
  const root = mkdtempSync(join(tmpdir(), 'basketra-receipt-correlation-'));
  const appConfig = config(root);
  const server = new BasketraServer(appConfig);
  try {
    await server.listen();
    const database = new BasketraDatabase(join(appConfig.dataDir, 'basketra.db'));
    try {
      const capture = { storageKey: `${'a'.repeat(64)}.png` };
      const job = database.createReceiptExtractionJob({ captures: [capture], verifyWithAi: true });
      database.startReceiptExtractionJob(job.id);
      const durableStore = new ReceiptDurableJobStore(database.path);
      try {
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
        durableStore.markPhase(job.id, 'ai_running');
      } finally {
        durableStore.close();
      }

      const response = await fetch(
        `http://127.0.0.1:${server.address().port}/api/v1/receipts/extraction-jobs/${encodeURIComponent(job.id)}`,
      );
      assert.equal(response.status, 200);
      const body = await response.json() as {
        job: {
          id: string;
          status: string;
          webApiResponseIds?: string[];
          progress?: {
            phase: string;
            pages: Array<{
              position: number;
              stage: string;
              ocr?: {
                text: string;
                confidence: number;
                source: string;
                deterministic: { items: unknown[]; metadata: Record<string, unknown> };
              };
            }>;
          };
          extraction?: unknown;
          errorCode?: string;
        };
      };

      assert.equal(body.job.id, job.id);
      assert.equal(body.job.status, 'running');
      assert.deepEqual(body.job.webApiResponseIds, ['resp_1234567']);
      assert.deepEqual(body.job.progress, {
        phase: 'ai_running',
        pages: [{
          position: 0,
          stage: 'ai',
          ocr: {
            text: 'PRIVATE RECEIPT TEXT',
            confidence: 0.9,
            source: 'local-tesseract',
            deterministic: { items: [], metadata: {} },
          },
        }],
      });
      assert.equal('extraction' in body.job, false);
      assert.equal('errorCode' in body.job, false);
      const publicProgress = JSON.stringify(body.job.progress);
      assert.equal(publicProgress.includes(capture.storageKey), false);
      assert.equal(publicProgress.includes('image/png'), false);
    } finally {
      database.close();
    }
  } finally {
    await server.close();
    rmSync(root, { recursive: true, force: true });
  }
});
