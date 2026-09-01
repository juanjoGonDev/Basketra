import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { listCatalog } from '../../src/api/catalog-management.ts';
import { BasketraDatabase } from '../../src/infrastructure/database.ts';

test('catalog latest prices preserve physical store identity when the observation has one', () => {
  const root = mkdtempSync(join(tmpdir(), 'basketra-catalog-store-price-'));
  const databasePath = join(root, 'basketra.db');
  const database = new BasketraDatabase(databasePath);
  try {
    const product = database.createProduct({ canonicalName: 'Leche', variantName: 'Leche entera 1 L' });
    const store = database.saveStore({
      retailerName: 'Mercadona',
      name: 'Mercadona Centro',
      address: 'Calle Centro 1',
    });
    database.confirmPriceObservation({
      productVariantId: product.id,
      retailerName: 'Mercadona',
      storeId: store.id,
      priceMinor: 119,
      packageNumerator: 1,
      packageDenominator: 1,
      packageUnit: 'unit',
      observedAt: '2026-09-01T11:30:00.000Z',
      confidence: 1,
      evidence: { sourceType: 'manual', sourceReference: 'store-price-contract' },
    });

    const latest = listCatalog(databasePath).products[0]?.latestPrices[0];
    assert.deepEqual(latest, {
      retailerId: store.retailerId,
      retailerName: 'Mercadona',
      storeId: store.id,
      storeName: 'Mercadona Centro',
      priceMinor: 119,
      observedAt: '2026-09-01T11:30:00.000Z',
      confidence: 1,
    });
  } finally {
    database.close();
    rmSync(root, { recursive: true, force: true });
  }
});
