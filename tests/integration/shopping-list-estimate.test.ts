import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { BasketraDatabase, CURRENT_SCHEMA_VERSION } from '../../src/infrastructure/database.ts';

test('shopping list Store selection, overrides and estimates use the latest saved physical Store price', () => {
  const root = mkdtempSync(join(tmpdir(), 'basketra-shopping-estimate-'));
  const databasePath = join(root, 'basketra.db');
  const database = new BasketraDatabase(databasePath, {
    clock: () => new Date('2026-09-05T12:00:00.000Z'),
  });

  try {
    assert.equal(CURRENT_SCHEMA_VERSION, 15);
    const mercadona = database.saveStore({ retailerName: 'Mercadona', name: 'Mercadona Centro' });
    const lidl = database.saveStore({ retailerName: 'Lidl', name: 'Lidl Centro' });
    const milk = database.createProduct({
      canonicalName: 'Leche',
      variantName: 'Leche entera 1 L',
      packageMinor: 1,
      packageUnit: 'l',
    });
    const rice = database.createProduct({
      canonicalName: 'Arroz',
      variantName: 'Arroz integral 500 g',
      packageMinor: 500,
      packageUnit: 'g',
    });

    database.confirmPriceObservation({
      productVariantId: milk.id,
      retailerName: 'Mercadona',
      storeId: mercadona.id,
      priceMinor: 119,
      packageNumerator: 1,
      packageDenominator: 1,
      packageUnit: 'unit',
      observedAt: '2026-09-01T10:00:00.000Z',
      confidence: 1,
      evidence: { sourceType: 'manual', sourceReference: 'milk-old' },
    });
    database.confirmPriceObservation({
      productVariantId: milk.id,
      retailerName: 'Mercadona',
      storeId: mercadona.id,
      priceMinor: 129,
      packageNumerator: 1,
      packageDenominator: 1,
      packageUnit: 'unit',
      observedAt: '2026-09-04T10:00:00.000Z',
      confidence: 1,
      evidence: { sourceType: 'manual', sourceReference: 'milk-latest' },
    });
    database.confirmPriceObservation({
      productVariantId: milk.id,
      retailerName: 'Lidl',
      storeId: lidl.id,
      priceMinor: 109,
      packageNumerator: 1,
      packageDenominator: 1,
      packageUnit: 'unit',
      observedAt: '2026-09-05T09:00:00.000Z',
      confidence: 1,
      evidence: { sourceType: 'manual', sourceReference: 'milk-lidl' },
    });
    database.confirmPriceObservation({
      productVariantId: rice.id,
      retailerName: 'Mercadona',
      storeId: mercadona.id,
      priceMinor: 200,
      packageNumerator: 500,
      packageDenominator: 1,
      packageUnit: 'g',
      observedAt: '2026-09-03T10:00:00.000Z',
      confidence: 1,
      evidence: { sourceType: 'manual', sourceReference: 'rice' },
    });

    const list = database.createShoppingList('Compra semanal');
    const selected = database.updateShoppingListStoreSelection(
      list.id,
      mercadona.id,
      list.version,
      'default',
    );
    assert.equal(selected.list.referenceStoreId, mercadona.id);

    const milkItem = database.addShoppingListItem({
      listId: list.id,
      text: 'Leche entera',
      quantityMinor: 2,
      unit: 'unit',
      exactRequired: false,
      substitutionAllowed: true,
      productVariantId: milk.id,
    });
    database.addShoppingListItem({
      listId: list.id,
      text: 'Arroz integral',
      quantityMinor: 1,
      unit: 'kg',
      exactRequired: false,
      substitutionAllowed: true,
      productVariantId: rice.id,
    });
    database.addShoppingListItem({
      listId: list.id,
      text: 'Tomate rama',
      quantityMinor: 1,
      unit: 'kg',
      exactRequired: false,
      substitutionAllowed: true,
    });

    const estimate = database.getShoppingListEstimate(list.id);
    assert.ok(estimate);
    assert.equal(estimate.referenceStoreId, mercadona.id);
    assert.equal(estimate.pricedItemCount, 2);
    assert.equal(estimate.unpricedItemCount, 1);
    assert.equal(estimate.totalMinor, 658);
    assert.equal(estimate.oldestObservedAt, '2026-09-03T10:00:00.000Z');

    const milkEstimate = estimate.lines.find((line) => line.itemId === milkItem.id);
    assert.equal(milkEstimate?.latestPriceMinor, 129);
    assert.equal(milkEstimate?.estimatedTotalMinor, 258);
    assert.equal(milkEstimate?.normalizedPriceMinor, 129);
    assert.equal(milkEstimate?.normalizedPriceUnit, 'l');

    const riceEstimate = estimate.lines.find((line) => line.text === 'Arroz integral');
    assert.equal(riceEstimate?.estimatedTotalMinor, 400);
    assert.equal(riceEstimate?.normalizedPriceMinor, 400);
    assert.equal(riceEstimate?.normalizedPriceUnit, 'kg');
    assert.equal(
      estimate.lines.find((line) => line.text === 'Tomate rama')?.reason,
      'product-required',
    );

    const milkOverride = database.updateShoppingListItem({
      listId: list.id,
      itemId: milkItem.id,
      expectedVersion: milkItem.version,
      storeOverrideId: lidl.id,
    });
    assert.equal(milkOverride.storeOverrideId, lidl.id);
    assert.equal(
      database.getShoppingListEstimate(list.id)?.lines
        .find((line) => line.itemId === milkItem.id)?.estimatedTotalMinor,
      218,
    );

    const current = database.getShoppingList(list.id);
    assert.ok(current);
    const all = database.updateShoppingListStoreSelection(
      list.id,
      mercadona.id,
      current.list.version,
      'all',
    );
    assert.equal(all.items.find((item) => item.id === milkItem.id)?.storeOverrideId, undefined);
    assert.equal(
      database.getShoppingListEstimate(list.id)?.lines
        .find((line) => line.itemId === milkItem.id)?.estimatedTotalMinor,
      258,
    );
  } finally {
    database.close();
    const raw = new DatabaseSync(databasePath, { readOnly: true });
    try {
      const listColumns = raw.prepare('PRAGMA table_info(shopping_lists)').all() as Array<{ name: string }>;
      const itemColumns = raw.prepare('PRAGMA table_info(shopping_list_items)').all() as Array<{ name: string }>;
      assert.ok(listColumns.some((column) => column.name === 'reference_store_id'));
      assert.ok(itemColumns.some((column) => column.name === 'store_override_id'));
    } finally {
      raw.close();
      rmSync(root, { recursive: true, force: true });
    }
  }
});
