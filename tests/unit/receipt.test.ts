import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateReceiptLineDiscountMinor,
  calculateReceiptLineTotal,
  deduplicateOverlappingLines,
  validateReceiptLine,
  validateReceiptTotal,
  type ReceiptLineInput,
} from '../../src/domain/receipt.ts';

const line: ReceiptLineInput = {
  description: 'Leche',
  quantity: 2,
  unitPriceMinor: 120,
  lineTotalMinor: 220,
  discountMinor: 20,
};

test('receipt arithmetic supports no discount and legacy fixed discounts', () => {
  assert.equal(calculateReceiptLineTotal({ quantity: 3, unitPriceMinor: 125 }), 375);
  assert.equal(calculateReceiptLineTotal(line), 220);
  assert.equal(calculateReceiptLineDiscountMinor(line), 20);
  assert.deepEqual(validateReceiptLine(line), { status: 'confirmed', expectedMinor: 220, differenceMinor: 0 });
  assert.deepEqual(validateReceiptLine({ description: 'Pan', quantity: 1, unitPriceMinor: 80, lineTotalMinor: 80 }), {
    status: 'confirmed', expectedMinor: 80, differenceMinor: 0,
  });
});

test('receipt arithmetic supports tagged amount discounts', () => {
  const tagged = { quantity: 2, unitPriceMinor: 120, discount: { type: 'amount' as const, amountMinor: 20 } };
  assert.equal(calculateReceiptLineDiscountMinor(tagged), 20);
  assert.equal(calculateReceiptLineTotal(tagged), 220);
});

test('receipt percentage discounts use basis points with half-up cent rounding', () => {
  assert.equal(calculateReceiptLineDiscountMinor({
    quantity: 1,
    unitPriceMinor: 175,
    discount: { type: 'percentage', basisPoints: 5_000 },
  }), 88);
  assert.equal(calculateReceiptLineTotal({
    quantity: 1,
    unitPriceMinor: 175,
    discount: { type: 'percentage', basisPoints: 5_000 },
  }), 87);
  assert.equal(calculateReceiptLineTotal({
    quantity: 1,
    unitPriceMinor: 101,
    discount: { type: 'percentage', basisPoints: 5_000 },
  }), 50);
  assert.equal(calculateReceiptLineTotal({
    quantity: 1,
    unitPriceMinor: 199,
    discount: { type: 'percentage', basisPoints: 0 },
  }), 199);
  assert.equal(calculateReceiptLineTotal({
    quantity: 1,
    unitPriceMinor: 199,
    discount: { type: 'percentage', basisPoints: 10_000 },
  }), 0);
});

test('receipt arithmetic rejects malformed, unsafe and excessive discounts', () => {
  for (const invalid of [-1, 1.2, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => validateReceiptLine({ ...line, quantity: invalid }), /non-negative safe integer/i);
    assert.throws(() => validateReceiptTotal([line], invalid), /non-negative safe integer/i);
  }
  assert.throws(() => validateReceiptLine({ ...line, lineTotalMinor: -1 }), /non-negative safe integer/i);
  assert.throws(() => calculateReceiptLineTotal({ quantity: 1, unitPriceMinor: 100, discountMinor: 101 }), /discount cannot exceed/i);
  assert.throws(() => calculateReceiptLineTotal({
    quantity: 1,
    unitPriceMinor: 100,
    discount: { type: 'amount', amountMinor: 101 },
  }), /discount cannot exceed/i);
  assert.throws(() => calculateReceiptLineTotal({
    quantity: 1,
    unitPriceMinor: 100,
    discount: { type: 'percentage', basisPoints: 10_001 },
  }), /cannot exceed 100%/i);
  assert.throws(() => calculateReceiptLineTotal({
    quantity: 1,
    unitPriceMinor: 100,
    discount: { type: 'percentage', basisPoints: -1 },
  }), /non-negative safe integer/i);
  assert.throws(() => calculateReceiptLineTotal({
    quantity: 1,
    unitPriceMinor: 100,
    discountMinor: 10,
    discount: { type: 'amount', amountMinor: 10 },
  }), /representation is mixed/i);
  assert.throws(() => calculateReceiptLineTotal({
    quantity: 1,
    unitPriceMinor: 100,
    discount: { type: 'amount', amountMinor: 10, basisPoints: 100 } as never,
  }), /representation is mixed/i);
  assert.throws(() => calculateReceiptLineTotal({
    quantity: 1,
    unitPriceMinor: 100,
    discount: { type: 'percentage', basisPoints: 100, amountMinor: 10 } as never,
  }), /representation is mixed/i);
  assert.throws(() => calculateReceiptLineTotal({
    quantity: 1,
    unitPriceMinor: 100,
    discount: { type: 'coupon' } as never,
  }), /type must be amount or percentage/i);
  assert.throws(() => calculateReceiptLineTotal({ quantity: Number.MAX_SAFE_INTEGER, unitPriceMinor: 2 }), /safe integer range/i);
});

test('receipt validation totals and overlap behavior remain compatible', () => {
  assert.deepEqual(validateReceiptLine({ ...line, lineTotalMinor: 221 }), {
    status: 'arithmetic-mismatch', expectedMinor: 220, differenceMinor: 1,
  });
  assert.deepEqual(validateReceiptLine({ description: ' ', quantity: 1, unitPriceMinor: 10, lineTotalMinor: 10 }), {
    status: 'unreadable', expectedMinor: 10, differenceMinor: 0,
  });
  assert.deepEqual(validateReceiptTotal([line, { description: 'Pan', quantity: 1, unitPriceMinor: 80, lineTotalMinor: 80 }], 300), {
    expectedMinor: 300, differenceMinor: 0, valid: true,
  });
  assert.deepEqual(validateReceiptTotal([line], 200), { expectedMinor: 220, differenceMinor: -20, valid: false });
  assert.throws(() => validateReceiptTotal([
    { description: 'A', quantity: 1, unitPriceMinor: 1, lineTotalMinor: Number.MAX_SAFE_INTEGER },
    { description: 'B', quantity: 1, unitPriceMinor: 1, lineTotalMinor: 1 },
  ], Number.MAX_SAFE_INTEGER), /total exceeds the safe integer range/i);
  assert.equal(deduplicateOverlappingLines([line, line, { ...line, description: ' leche ' }, { ...line, lineTotalMinor: 221 }]).length, 2);
});
