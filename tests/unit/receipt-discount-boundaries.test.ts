import test from 'node:test';
import assert from 'node:assert/strict';
import { parseReceiptLineDiscount } from '../../src/domain/receipt.ts';
import { assembleReceiptExtraction } from '../../src/receipts/result.ts';

test('typed receipt discounts reject numeric strings instead of coercing them', () => {
  assert.throws(() => parseReceiptLineDiscount({ type: 'amount', amountMinor: '88' }), /non-negative safe integer/i);
  assert.throws(() => parseReceiptLineDiscount({ type: 'percentage', basisPoints: '5000' }), /non-negative safe integer/i);
});

test('typed receipt discounts reject non-object and array containers', () => {
  for (const value of [null, 88, '50%', []]) {
    assert.throws(() => parseReceiptLineDiscount(value), /tagged discount object/i);
  }
});

test('receipt extraction omits empty unassigned discount collections for compatibility', () => {
  const result = assembleReceiptExtraction([{
    position: 0,
    storageKey: 'receipt-page-1',
    mimeType: 'image/png',
    text: 'PAN 1,00',
    confidence: 0.9,
    source: 'local-tesseract',
    deterministic: {
      items: [{ description: 'PAN', quantity: 1, unitPriceMinor: 100, lineTotalMinor: 100, confidence: 1, sourceLines: [1] }],
      metadata: {},
    },
  }]);
  assert.equal('unassignedDiscounts' in result.final, false);
});
