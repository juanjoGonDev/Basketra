import test from 'node:test';
import assert from 'node:assert/strict';
import {
  RECEIPT_SCHEMA,
  buildReceiptVerificationInstructions,
} from '../../src/receipts/extraction.ts';

test('receipt AI schema accepts an affected quantity on a typed discount', () => {
  const interpretation = RECEIPT_SCHEMA.parse({
    currency: 'EUR',
    correctedText: '2 products and one partial discount',
    items: [{
      description: 'BEBIDA COCO 0% A',
      quantity: 2,
      unitPriceMinor: 175,
      lineTotalMinor: 262,
      discount: { type: 'percentage', basisPoints: 5_000, quantity: 1 },
      confidence: 0.99,
      sourceLines: [1, 2, 3],
    }],
    warnings: [],
  });

  assert.deepEqual(interpretation.items[0]?.discount, {
    type: 'percentage',
    basisPoints: 5_000,
    quantity: 1,
  });
});

test('receipt AI instructions require whole-receipt discount scanning and exact-row aggregation', () => {
  const instructions = buildReceiptVerificationInstructions();

  assert.match(instructions, /discounts and promotions across the whole receipt/i);
  assert.match(instructions, /after an intermediate total/i);
  assert.match(instructions, /group repeated identical product rows/i);
  assert.match(instructions, /affected quantity/i);
  assert.match(instructions, /duplicate identical rows are not ambiguous/i);
  assert.doesNotMatch(instructions, /including duplicate identical products, do not attach/i);
});
