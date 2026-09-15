import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ACTIVE_PAGE_STATUSES,
  PAGE_LABELS,
  PAGE_STATUS,
  QUEUED_PAGE_STATUSES,
  canApplyDurableUpdate,
  durableJobStatusToPageStatus,
  durableProgressStageToPageStatus,
  pageStageValue,
} from '../../src/web/receipt-page-state.js';

test('durable job status distinguishes submitted, queued and running work', () => {
  assert.equal(durableJobStatusToPageStatus('submitting'), PAGE_STATUS.SUBMITTING);
  assert.equal(durableJobStatusToPageStatus('queued'), PAGE_STATUS.QUEUED);
  assert.equal(durableJobStatusToPageStatus('running', { verifyWithAi: true }), PAGE_STATUS.AI);
  assert.equal(durableJobStatusToPageStatus('running', { directPdf: true }), PAGE_STATUS.AI);
  assert.equal(durableJobStatusToPageStatus('running', { verifyWithAi: false }), PAGE_STATUS.OCR);
  assert.equal(durableJobStatusToPageStatus('completed'), PAGE_STATUS.COMPLETED);
  assert.equal(durableJobStatusToPageStatus('failed'), PAGE_STATUS.ERROR);
  assert.equal(durableJobStatusToPageStatus('cancelled'), PAGE_STATUS.CANCELLED);
});

test('durable progress never exposes direct PDF OCR as a queued state once provider work started', () => {
  assert.equal(durableProgressStageToPageStatus('queued', { directPdf: true }), PAGE_STATUS.QUEUED);
  assert.equal(durableProgressStageToPageStatus('ocr', { directPdf: true }), PAGE_STATUS.AI);
  assert.equal(durableProgressStageToPageStatus('ocr', { directPdf: false }), PAGE_STATUS.OCR);
  assert.equal(durableProgressStageToPageStatus('ai', { directPdf: true }), PAGE_STATUS.AI);
  assert.equal(durableProgressStageToPageStatus('completed', { directPdf: true }), PAGE_STATUS.COMPLETED);
  assert.equal(durableProgressStageToPageStatus('error', { directPdf: true }), PAGE_STATUS.ERROR);
});

test('queue labels and active sets keep sent work out of the pending queue bucket', () => {
  assert.equal(PAGE_LABELS[PAGE_STATUS.SUBMITTING], 'Enviando a IA');
  assert.equal(PAGE_LABELS[PAGE_STATUS.QUEUED], 'En cola IA');
  assert.equal(PAGE_LABELS[PAGE_STATUS.AI], 'Verificando con IA');

  assert.equal(QUEUED_PAGE_STATUSES.has(PAGE_STATUS.QUEUED), true);
  assert.equal(QUEUED_PAGE_STATUSES.has(PAGE_STATUS.PENDING), true);
  assert.equal(QUEUED_PAGE_STATUSES.has(PAGE_STATUS.SUBMITTING), false);
  assert.equal(QUEUED_PAGE_STATUSES.has(PAGE_STATUS.AI), false);

  assert.equal(ACTIVE_PAGE_STATUSES.has(PAGE_STATUS.SUBMITTING), true);
  assert.equal(ACTIVE_PAGE_STATUSES.has(PAGE_STATUS.AI), true);
  assert.equal(ACTIVE_PAGE_STATUSES.has(PAGE_STATUS.QUEUED), false);
});

test('durable updates are ignored after terminal local decisions', () => {
  for (const status of [PAGE_STATUS.COMPLETED, PAGE_STATUS.MANUAL, PAGE_STATUS.ERROR, PAGE_STATUS.CANCELLED]) {
    assert.equal(canApplyDurableUpdate(status), false, status);
  }
  for (const status of [PAGE_STATUS.READY, PAGE_STATUS.SUBMITTING, PAGE_STATUS.QUEUED, PAGE_STATUS.OCR, PAGE_STATUS.AI]) {
    assert.equal(canApplyDurableUpdate(status), true, status);
  }
});

test('visual progress values separate waiting, submitted and completed phases', () => {
  const lifecycle = [
    PAGE_STATUS.READY,
    PAGE_STATUS.SUBMITTING,
    PAGE_STATUS.QUEUED,
    PAGE_STATUS.AI,
    PAGE_STATUS.COMPLETED,
  ];
  assert.deepEqual(lifecycle.map(pageStageValue), [0, 1, 0, 2, 3]);
  assert.equal(pageStageValue(PAGE_STATUS.MANUAL), 3);
  assert.equal(pageStageValue(PAGE_STATUS.ERROR), 0);
});
