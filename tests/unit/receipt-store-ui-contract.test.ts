import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const review = readFileSync(new URL('../../src/web/receipt-review.js', import.meta.url), 'utf8');
const view = readFileSync(new URL('../../src/web/receipts.js', import.meta.url), 'utf8');

test('receipt review keeps an evidenced store visible and clears it when retailer changes', () => {
  assert.match(view, /receipt-detected-store/u);
  assert.match(review, /applyStoreCandidate/u);
  assert.match(review, /clearIncompatibleDetectedStore/u);
  assert.match(review, /storeId: state\.detectedStoreId/u);
  assert.match(review, /storeName: state\.detectedStoreName/u);
});
