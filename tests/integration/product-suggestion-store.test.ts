import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { BasketraDatabase } from '../../src/infrastructure/database.ts';

test('product suggestions expose package and latest exact Store price context', () => {
  const root = mkdtempSync(join(tmpdir(), 'basketra-suggestion-store-'));
  const database = new BasketraDatabase(join(root, 'basketra.db'));
  try {
    const first = database.createProduct({
      canonicalName: 'Leche',
      variantName: 'Leche entera 1 L',
      packageMinor: 1,
      packageUnit: 'l',
    });
    const second = database.createProduct({
      canonicalProductId: first.canonicalProductId,
      variantName: 'Leche entera 2 L',
      packageMinor: 2,
      packageUnit: 'l',
    });
    const store = database.saveStore({ retailerName: 'Mercado', name: 'Mercado Centro' });
    database.confirmPriceObservation({
      productVariantId: first.id,
      retailerName: 'Mercado',
      storeId: store.id,
      priceMinor: 129,
      packageNumerator: 1,
      packageDenominator: 1,
      packageUnit: 'unit',
      observedAt: '2026-09-05T10:00:00.000Z',
      confidence: 1,
      evidence: { sourceType: 'manual', sourceReference: 'suggestion-price' },
    });

    const suggestion = database.searchProducts('leche', 8, store.id).find((entry) => entry.id === first.id);
    assert.ok(suggestion);
    assert.equal(suggestion.canonicalProductId, first.canonicalProductId);
    assert.equal(suggestion.packageMinor, 1);
    assert.equal(suggestion.packageUnit, 'l');
    assert.deepEqual(suggestion.latestStorePrice, {
      storeId: store.id,
      storeName: 'Mercado Centro',
      retailerName: 'Mercado',
      priceMinor: 129,
      observedAt: '2026-09-05T10:00:00.000Z',
    });
    assert.deepEqual(
      database.listProductVariantsByParent(first.canonicalProductId).map((variant) => variant.id),
      [first.id, second.id],
    );
  } finally {
    database.close();
    rmSync(root, { recursive: true, force: true });
  }
});
