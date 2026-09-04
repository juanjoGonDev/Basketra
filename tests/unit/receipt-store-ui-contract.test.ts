import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const review = readFileSync(new URL('../../src/web/receipt-review.js', import.meta.url), 'utf8');
const view = readFileSync(new URL('../../src/web/receipts.js', import.meta.url), 'utf8');

test('receipt review requires one Store and keeps receipt-level ownership in the confirmation payload', () => {
  assert.match(view, /Tienda \(obligatoria\)/u);
  assert.match(view, /id="receipt-store"[^>]*required/u);
  assert.doesNotMatch(view, /Tienda detectada \(opcional\)/u);
  assert.match(review, /applyStoreCandidate/u);
  assert.match(review, /clearIncompatibleDetectedStore/u);
  assert.match(review, /storeId: state\.detectedStoreId/u);
  assert.match(review, /storeName: state\.detectedStoreName/u);
  assert.match(review, /Selecciona o escribe una tienda antes de confirmar/u);
});
