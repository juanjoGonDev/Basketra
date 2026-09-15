import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const review = readFileSync(new URL('../../src/web/receipt-review.js', import.meta.url), 'utf8');
const view = readFileSync(new URL('../../src/web/receipts.js', import.meta.url), 'utf8');

test('receipt review requires one Store and keeps receipt-level ownership in the confirmation payload', () => {
  assert.match(view, /id="receipt-store"[^>]*required/u);
  assert.match(view, /La tienda es obligatoria/u);
  assert.match(view, /className = 'flow-group receipt-store-fields'/u);
  assert.match(view, /reviewEditor\.prepend\(storeFields\)/u);
  assert.doesNotMatch(view, /manualBody\.prepend\(retailer\)/u);
  assert.doesNotMatch(view, /Tienda detectada \(opcional\)/u);
  assert.match(review, /applyStoreCandidate/u);
  assert.match(review, /clearIncompatibleDetectedStore/u);
  assert.match(review, /detectedStoreSelected/u);
  assert.match(review, /storeId: state\.detectedStoreId/u);
  assert.match(review, /storeName/u);
  assert.match(review, /Elige o escribe una tienda antes de confirmar el ticket/u);
});

test('completed captures remain independently selectable drafts and do not leak source ownership to the API', () => {
  assert.match(review, /export function applyCaptureDrafts/u);
  assert.match(review, /captureKeys: \[key\]/u);
  assert.match(review, /export function selectReceiptDraft/u);
  assert.match(review, /function receiptApiItems/u);
  assert.match(review, /sourceCaptureKey: _sourceCaptureKey/u);
  assert.match(review, /draftCaptures\.map\(capture =>/u);
  assert.match(view, /selectReceiptDraft\(event\.target\.value\)/u);
});
