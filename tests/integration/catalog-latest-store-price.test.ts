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


test('product price history is bounded, chronological and includes readable store identity', () => {
  const root = mkdtempSync(join(tmpdir(), 'basketra-catalog-price-history-'));
  const database = new BasketraDatabase(join(root, 'basketra.db'));
  try {
    const product = database.createProduct({ canonicalName: 'Yogur', variantName: 'Yogur natural' });
    const store = database.saveStore({ retailerName: 'Mercado', name: 'Mercado Centro' });
    for (let index = 0; index < 185; index += 1) {
      database.confirmPriceObservation({
        productVariantId: product.id,
        retailerName: 'Mercado',
        storeId: store.id,
        priceMinor: 100 + index,
        packageNumerator: 1,
        packageDenominator: 1,
        packageUnit: 'unit',
        observedAt: new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString(),
        confidence: 1,
        evidence: { sourceType: 'manual', sourceReference: `history-${index}` },
      });
    }

    const history = database.listPriceObservations(product.id);
    assert.equal(history.length, 180);
    assert.equal(history[0]?.priceMinor, 284);
    assert.equal(history.at(-1)?.priceMinor, 105);
    assert.equal(history[0]?.retailerName, 'Mercado');
    assert.equal(history[0]?.storeName, 'Mercado Centro');
    assert.ok(new Date(history[0]!.observedAt).getTime() > new Date(history.at(-1)!.observedAt).getTime());
  } finally {
    database.close();
    rmSync(root, { recursive: true, force: true });
  }
});
