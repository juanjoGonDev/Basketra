import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { getCatalogProductRelations, listCatalog } from '../../src/api/catalog-management.ts';
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


test('catalog comparison keeps only the newest observation per location and sorts cheapest first', () => {
  const root = mkdtempSync(join(tmpdir(), 'basketra-catalog-store-comparison-'));
  const databasePath = join(root, 'basketra.db');
  const database = new BasketraDatabase(databasePath);
  try {
    const product = database.createProduct({ canonicalName: 'Arroz', variantName: 'Arroz largo 1 kg' });
    const north = database.saveStore({ retailerName: 'Mercado', name: 'Mercado Norte' });
    const south = database.saveStore({ retailerName: 'Mercado', name: 'Mercado Sur' });
    const observe = (storeId: string | undefined, priceMinor: number, observedAt: string, reference: string) => {
      database.confirmPriceObservation({
        productVariantId: product.id,
        retailerName: 'Mercado',
        ...(storeId ? { storeId } : {}),
        priceMinor,
        packageNumerator: 1,
        packageDenominator: 1,
        packageUnit: 'unit',
        observedAt,
        confidence: 1,
        evidence: { sourceType: 'manual', sourceReference: reference },
      });
    };

    observe(north.id, 160, '2026-09-01T10:00:00.000Z', 'north-old');
    observe(north.id, 125, '2026-09-03T10:00:00.000Z', 'north-new');
    observe(south.id, 110, '2026-09-02T10:00:00.000Z', 'south');
    observe(undefined, 99, '2026-09-04T10:00:00.000Z', 'retailer-only');

    assert.deepEqual(
      listCatalog(databasePath).products[0]?.latestPrices.map(entry => ({
        storeId: entry.storeId,
        storeName: entry.storeName,
        priceMinor: entry.priceMinor,
        observedAt: entry.observedAt,
      })),
      [
        { storeId: undefined, storeName: undefined, priceMinor: 99, observedAt: '2026-09-04T10:00:00.000Z' },
        { storeId: south.id, storeName: 'Mercado Sur', priceMinor: 110, observedAt: '2026-09-02T10:00:00.000Z' },
        { storeId: north.id, storeName: 'Mercado Norte', priceMinor: 125, observedAt: '2026-09-03T10:00:00.000Z' },
      ],
    );
  } finally {
    database.close();
    rmSync(root, { recursive: true, force: true });
  }
});


test('product detail relations expose up to 100 cheapest latest locations and report truncation', () => {
  const root = mkdtempSync(join(tmpdir(), 'basketra-catalog-detail-prices-'));
  const databasePath = join(root, 'basketra.db');
  const database = new BasketraDatabase(databasePath);
  try {
    const product = database.createProduct({ canonicalName: 'Agua', variantName: 'Agua 1 L' });
    for (let index = 0; index < 101; index += 1) {
      const store = database.saveStore({ retailerName: `Cadena ${index}`, name: `Tienda ${index}` });
      database.confirmPriceObservation({
        productVariantId: product.id,
        retailerName: store.retailerName,
        storeId: store.id,
        priceMinor: 1000 - index,
        packageNumerator: 1,
        packageDenominator: 1,
        packageUnit: 'unit',
        observedAt: new Date(Date.UTC(2026, 8, 1, 0, index)).toISOString(),
        confidence: 1,
        evidence: { sourceType: 'manual', sourceReference: `detail-${index}` },
      });
    }

    const relations = getCatalogProductRelations(databasePath, product.id);
    assert.equal(relations.latestPrices.length, 100);
    assert.equal(relations.latestPricesTruncated, true);
    assert.equal(relations.latestPrices[0]?.priceMinor, 900);
    assert.equal(relations.latestPrices.at(-1)?.priceMinor, 999);
  } finally {
    database.close();
    rmSync(root, { recursive: true, force: true });
  }
});
