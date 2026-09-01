import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('service worker versions the shell and receipt review owns typed discount styles', () => {
  const serviceWorker = readFileSync(new URL('../../src/web/sw.js', import.meta.url), 'utf8');
  const receiptReviewStyles = readFileSync(new URL('../../src/web/receipt-review.css', import.meta.url), 'utf8');
  assert.match(serviceWorker, /basketra-shell-v24/u);
  assert.match(serviceWorker, /'\/receipt-review\.css'/u);
  assert.doesNotMatch(serviceWorker, /receipt-discount\.css/u);
  assert.match(receiptReviewStyles, /\.receipt-line-result/u);
  assert.match(receiptReviewStyles, /\.receipt-discount-review-warning/u);
  assert.match(receiptReviewStyles, /\.receipt-discount-quantity-field/u);
});
