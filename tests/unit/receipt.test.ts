import test from 'node:test';
import assert from 'node:assert/strict';
import { deduplicateOverlappingLines, validateReceiptLine, validateReceiptTotal, type ReceiptLineInput } from '../../src/domain/receipt.ts';

const line: ReceiptLineInput = { description:'Leche', quantity:2, unitPriceMinor:120, lineTotalMinor:220, discountMinor:20 };

test('receipt arithmetic validates lines, totals and overlaps', () => {
  assert.deepEqual(validateReceiptLine(line), { status:'confirmed', expectedMinor:220, differenceMinor:0 });
  assert.deepEqual(validateReceiptLine({ description:'Pan', quantity:1, unitPriceMinor:80, lineTotalMinor:80 }), { status:'confirmed', expectedMinor:80, differenceMinor:0 });
  assert.deepEqual(validateReceiptLine({ ...line, lineTotalMinor:221 }), { status:'arithmetic-mismatch', expectedMinor:220, differenceMinor:1 });
  assert.deepEqual(validateReceiptLine({ description:' ', quantity:1, unitPriceMinor:10, lineTotalMinor:10 }), { status:'unreadable', expectedMinor:0, differenceMinor:10 });
  assert.deepEqual(validateReceiptTotal([line, { description:'Pan', quantity:1, unitPriceMinor:80, lineTotalMinor:80 }], 300), { expectedMinor:300, differenceMinor:0, valid:true });
  assert.deepEqual(validateReceiptTotal([line], 200), { expectedMinor:220, differenceMinor:-20, valid:false });
  assert.deepEqual(deduplicateOverlappingLines([line, line, { ...line, description:' leche ' }, { ...line, lineTotalMinor:221 }]).length, 2);
});

test('receipt arithmetic rejects unsafe values', () => {
  for (const invalid of [-1, 1.2, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => validateReceiptLine({ ...line, quantity:invalid }), RangeError);
    assert.throws(() => validateReceiptTotal([line], invalid), RangeError);
  }
});
