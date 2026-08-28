import assert from 'node:assert/strict';
import test from 'node:test';

import { buildReceiptJobProgress } from '../../src/receipts/progress.ts';
import type { ReceiptDurableJobState } from '../../src/receipts/durable-job-store.ts';

function durableState(): ReceiptDurableJobState {
  return {
    jobId: 'receiptextractionjob_progress123',
    generation: 1,
    phase: 'ai_running',
    deadlineAt: '2026-08-28T22:00:00.000Z',
    pageCount: 3,
    pages: [
      {
        position: 0,
        ocr: {
          position: 0,
          storageKey: `${'a'.repeat(64)}.png`,
          mimeType: 'image/png',
          text: 'LECHE 1,20\nTOTAL 1,20',
          confidence: 0.91,
          source: 'local-tesseract',
          deterministic: {
            items: [{
              description: 'LECHE',
              quantity: 1,
              unitPriceMinor: 120,
              lineTotalMinor: 120,
              confidence: 0.7,
              sourceLines: [1],
            }],
            metadata: { declaredTotalMinor: 120 },
          },
        },
        responseId: 'resp_progress123',
        remoteStatus: 'in_progress',
      },
      {
        position: 1,
        ocr: {
          position: 1,
          storageKey: `${'b'.repeat(64)}.jpg`,
          mimeType: 'image/jpeg',
          text: 'PAN 0,80',
          confidence: 0.88,
          source: 'local-tesseract',
          deterministic: {
            items: [{
              description: 'PAN',
              quantity: 1,
              unitPriceMinor: 80,
              lineTotalMinor: 80,
              confidence: 0.7,
              sourceLines: [1],
            }],
            metadata: {},
          },
        },
        responseId: 'resp_progress456',
        remoteStatus: 'completed',
        remoteResult: { private: 'provider result must not be exposed by progress' },
      },
      { position: 2 },
    ],
  };
}

test('durable job progress exposes bounded OCR evidence without storage or provider payloads', () => {
  const progress = buildReceiptJobProgress(durableState());

  assert.equal(progress.phase, 'ai_running');
  assert.deepEqual(progress.pages.map(page => page.stage), ['ai', 'completed', 'ocr']);
  assert.deepEqual(progress.pages[0]?.ocr, {
    text: 'LECHE 1,20\nTOTAL 1,20',
    confidence: 0.91,
    source: 'local-tesseract',
    deterministic: {
      items: [{
        description: 'LECHE',
        quantity: 1,
        unitPriceMinor: 120,
        lineTotalMinor: 120,
        confidence: 0.7,
        sourceLines: [1],
      }],
      metadata: { declaredTotalMinor: 120 },
    },
  });

  const serialized = JSON.stringify(progress);
  assert.doesNotMatch(serialized, /storageKey|mimeType|resp_progress|provider result|remoteResult/u);
});

test('terminal remote failures expose only the semantic stage while retaining OCR evidence', () => {
  const state = durableState();
  const progress = buildReceiptJobProgress({
    ...state,
    phase: 'failed',
    pages: [
      {
        ...state.pages[0]!,
        remoteStatus: 'failed',
        remoteErrorCode: 'PRIVATE_UPSTREAM_DETAIL',
      },
    ],
    pageCount: 1,
  });

  assert.equal(progress.pages[0]?.stage, 'error');
  assert.equal(progress.pages[0]?.ocr?.text, 'LECHE 1,20\nTOTAL 1,20');
  assert.doesNotMatch(JSON.stringify(progress), /PRIVATE_UPSTREAM_DETAIL/u);
});
