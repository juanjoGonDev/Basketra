import test from 'node:test';
import assert from 'node:assert/strict';
import { parseReceiptConfirmation } from '../../src/receipts/import.ts';

function confirmation(categoryId?: string) {
  return {
    importKey: 'receipt-category-test',
    declaredTotalMinor: 120,
    originalText: 'LECHE 1,20',
    provider: 'test',
    items: [{
      description: 'LECHE',
      quantity: 1,
      unitPriceMinor: 120,
      lineTotalMinor: 120,
      confidence: 1,
      userConfirmed: true,
      ...(categoryId ? { categoryId } : {}),
    }],
  };
}

test('receipt confirmation preserves a validated category id', () => {
  const parsed = parseReceiptConfirmation(confirmation('category_dairy'));
  assert.equal(parsed.input.items[0]?.categoryId, 'category_dairy');
});

test('receipt confirmation keeps manual lines uncategorized for database fallback', () => {
  const parsed = parseReceiptConfirmation(confirmation());
  assert.equal(parsed.input.items[0]?.categoryId, undefined);
});

test('receipt confirmation rejects oversized category ids at the API boundary', () => {
  assert.throws(
    () => parseReceiptConfirmation(confirmation(`category_${'x'.repeat(121)}`)),
    /Expected at most 128 characters/,
  );
});

test('receipt confirmation preserves storeId and evidence-backed storeName', () => {
  const parsed = parseReceiptConfirmation({
    ...confirmation(),
    retailerName: 'Mercadona',
    storeId: 'store_centro',
    storeName: 'Mercadona Centro',
  });
  assert.equal(parsed.input.storeId, 'store_centro');
  assert.equal(parsed.input.storeName, 'Mercadona Centro');
  assert.throws(() => parseReceiptConfirmation({ ...confirmation(), storeID: 'store_centro' }), /storeID/);
});
