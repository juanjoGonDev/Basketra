import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateReceiptLineDiscountMinor,
  calculateReceiptLineTotal,
  parseReceiptLineDiscount,
} from '../../src/domain/receipt.ts';

test('percentage discounts can target only part of an aggregated receipt quantity', () => {
  const line = {
    quantity: 2,
    unitPriceMinor: 175,
    discount: { type: 'percentage', basisPoints: 5_000, quantity: 1 } as const,
  };

  assert.equal(calculateReceiptLineDiscountMinor(line), 88);
  assert.equal(calculateReceiptLineTotal(line), 262);
});

test('amount discounts validate against the affected subset subtotal', () => {
  assert.equal(calculateReceiptLineTotal({
    quantity: 3,
    unitPriceMinor: 100,
    discount: { type: 'amount', amountMinor: 90, quantity: 1 },
  }), 210);

  assert.throws(() => calculateReceiptLineTotal({
    quantity: 3,
    unitPriceMinor: 100,
    discount: { type: 'amount', amountMinor: 101, quantity: 1 },
  }), /affected subtotal/i);
});

test('discount quantity must be a positive safe integer within the receipt line quantity', () => {
  assert.throws(() => parseReceiptLineDiscount({
    type: 'percentage',
    basisPoints: 5_000,
    quantity: '1',
  }), /quantity must be a positive safe integer/i);

  assert.throws(() => parseReceiptLineDiscount({
    type: 'percentage',
    basisPoints: 5_000,
    quantity: 0,
  }), /quantity must be a positive safe integer/i);

  assert.throws(() => parseReceiptLineDiscount({
    type: 'percentage',
    basisPoints: 5_000,
    quantity: 1.5,
  }), /quantity must be a positive safe integer/i);

  assert.throws(() => calculateReceiptLineTotal({
    quantity: 2,
    unitPriceMinor: 175,
    discount: { type: 'percentage', basisPoints: 5_000, quantity: 3 },
  }), /cannot exceed the receipt line quantity/i);
});

test('discounts without an affected quantity retain whole-line compatibility semantics', () => {
  assert.equal(calculateReceiptLineDiscountMinor({
    quantity: 2,
    unitPriceMinor: 175,
    discount: { type: 'percentage', basisPoints: 5_000 },
  }), 175);
  assert.equal(calculateReceiptLineTotal({
    quantity: 2,
    unitPriceMinor: 175,
    discount: { type: 'amount', amountMinor: 88 },
  }), 262);
});
