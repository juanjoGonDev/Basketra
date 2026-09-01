import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { listCatalog } from '../../src/api/catalog-management.ts';
import { BasketraDatabase } from '../../src/infrastructure/database.ts';

function confirmedReceipt(importKey: string, unitPriceMinor: number) {
  return {
    importKey,
    declaredTotalMinor: unitPriceMinor,
    originalText: `BEBIDA COCO ${unitPriceMinor}`,
    provider: 'manual-or-embedded',
    retailerName: 'Alcampo',
    deterministic: { items: [{ description: 'Bebida coco 0% A', unitPriceMinor }] },
    items: [{
      description: 'Bebida coco 0% A',
      quantity: 1,
      unitPriceMinor,
      lineTotalMinor: unitPriceMinor,
      status: 'confirmed',
      confidence: 1,
    }],
  } as const;
}

test('catalog snapshot exposes bounded latest confirmed receipt prices per retailer or store', () => {
  const root = mkdtempSync(join(tmpdir(), 'basketra-receipt-catalog-api-'));
  const databasePath = join(root, 'basketra.db');
  let now = new Date('2026-09-01T10:00:00.000Z');
  const database = new BasketraDatabase(databasePath, { clock: () => now });
  try {
    database.importReceipt(confirmedReceipt('receipt-price-0001', 88));
    now = new Date('2026-09-02T10:00:00.000Z');
    database.importReceipt(confirmedReceipt('receipt-price-0002', 92));

    const snapshot = listCatalog(databasePath, { query: 'Alcampo', limit: 50, offset: 0 });
    assert.equal(snapshot.products.length, 1);
    const product = snapshot.products[0]!;
    assert.equal(product.variantName, 'Bebida coco 0% A');
    assert.deepEqual(product.retailerNames.map(({ retailerName, title }) => ({ retailerName, title })), [
      { retailerName: 'Alcampo', title: 'Bebida coco 0% A' },
    ]);
    assert.deepEqual(product.latestPrices, [{
      retailerId: product.retailerNames[0]!.retailerId,
      retailerName: 'Alcampo',
      priceMinor: 92,
      observedAt: '2026-09-02T10:00:00.000Z',
      confidence: 1,
    }]);
  } finally {
    database.close();
    rmSync(root, { recursive: true, force: true });
  }
});
