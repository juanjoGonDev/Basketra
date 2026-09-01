import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { BasketraDatabase, CURRENT_SCHEMA_VERSION } from '../../src/infrastructure/database.ts';

const RECEIPT_CATALOG_MIGRATION_VERSION = 7;

function receiptInput(importKey: string, description: string, unitPriceMinor: number, retailerName?: string) {
  return {
    importKey,
    declaredTotalMinor: unitPriceMinor,
    originalText: `${description} 1 ${unitPriceMinor}`,
    provider: 'manual-or-embedded',
    ...(retailerName ? { retailerName } : {}),
    deterministic: { items: [{ description, unitPriceMinor }] },
    items: [{
      description,
      quantity: 1,
      unitPriceMinor,
      lineTotalMinor: unitPriceMinor,
      status: 'confirmed',
      confidence: 1,
    }],
  } as const;
}

function readProjection(path: string, receiptId: string) {
  const database = new DatabaseSync(path, { readOnly: true });
  try {
    const item = database.prepare(`
      SELECT id, original_description AS description, product_variant_id AS productVariantId
      FROM receipt_items
      WHERE receipt_id = ?
      ORDER BY created_at, id
      LIMIT 1
    `).get(receiptId) as { id: string; description: string; productVariantId: string | null };
    const listing = item.productVariantId
      ? database.prepare(`
          SELECT retailers.name AS retailerName, retailer_listings.title
          FROM retailer_listings
          JOIN retailers ON retailers.id = retailer_listings.retailer_id
          WHERE retailer_listings.product_variant_id = ?
          ORDER BY retailer_listings.created_at, retailer_listings.id
          LIMIT 1
        `).get(item.productVariantId) as { retailerName: string; title: string } | undefined
      : undefined;
    const counts = database.prepare(`
      SELECT
        (SELECT COUNT(*) FROM canonical_products) AS canonicalProducts,
        (SELECT COUNT(*) FROM product_variants) AS variants,
        (SELECT COUNT(*) FROM price_observations) AS prices,
        (SELECT COUNT(*) FROM external_evidence WHERE source_type = 'receipt') AS receiptEvidence
    `).get() as { canonicalProducts: number; variants: number; prices: number; receiptEvidence: number };
    return { item, listing, counts };
  } finally {
    database.close();
  }
}

test('confirmed receipt lines become reusable catalog variants with retailer names and immutable prices', () => {
  const root = mkdtempSync(join(tmpdir(), 'basketra-receipt-catalog-'));
  const databasePath = join(root, 'basketra.db');
  const database = new BasketraDatabase(databasePath, { clock: () => new Date('2026-09-01T12:00:00.000Z') });
  try {
    const firstInput = receiptInput('receipt-catalog-0001', 'Bebida coco 0% A', 88, 'Alcampo');
    const firstReceiptId = database.importReceipt(firstInput);
    const firstProducts = database.searchProducts('bebida', 8);
    assert.equal(firstProducts.length, 1);
    const variantId = firstProducts[0]!.id;
    assert.equal(database.listPriceObservations(variantId).length, 1);
    assert.equal(database.listPriceObservations(variantId)[0]?.priceMinor, 88);

    const firstProjection = readProjection(databasePath, firstReceiptId);
    assert.equal(firstProjection.item.productVariantId, variantId);
    assert.equal(firstProjection.item.description, 'Bebida coco 0% A');
    assert.deepEqual(firstProjection.listing, { retailerName: 'Alcampo', title: 'Bebida coco 0% A' });

    assert.equal(database.importReceipt(firstInput), firstReceiptId);
    assert.equal(database.listPriceObservations(variantId).length, 1);

    database.importReceipt(receiptInput('receipt-catalog-0002', 'Bebida coco 0% A', 92, 'Alcampo'));
    assert.equal(database.searchProducts('bebida', 8).length, 1);
    assert.deepEqual(database.listPriceObservations(variantId).map((entry) => entry.priceMinor), [92, 88]);

    const noRetailerReceiptId = database.importReceipt(receiptInput('receipt-catalog-0003', 'Pan rústico', 145));
    const bread = database.searchProducts('rústico', 8);
    assert.equal(bread.length, 1);
    assert.equal(database.listPriceObservations(bread[0]!.id).length, 0);
    assert.equal(readProjection(databasePath, noRetailerReceiptId).item.productVariantId, bread[0]!.id);
  } finally {
    database.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('migration reconciles historical confirmed receipt rows without overwriting receipt evidence', () => {
  const root = mkdtempSync(join(tmpdir(), 'basketra-receipt-catalog-backfill-'));
  const databasePath = join(root, 'basketra.db');
  const migrationBackupDir = join(root, 'migration-backups');
  const initial = new BasketraDatabase(databasePath, { migrationBackupDir });
  initial.close();
  assert.equal(CURRENT_SCHEMA_VERSION, RECEIPT_CATALOG_MIGRATION_VERSION);

  const legacy = new DatabaseSync(databasePath);
  try {
    legacy.exec('PRAGMA foreign_keys = ON;');
    legacy.exec('DROP TRIGGER IF EXISTS receipt_items_project_catalog;');
    legacy.prepare('DELETE FROM schema_migrations WHERE version = ?').run(RECEIPT_CATALOG_MIGRATION_VERSION);
    legacy.prepare('INSERT INTO retailers(id, name, created_at) VALUES (?, ?, ?)').run('retailer_legacy', 'Mercadona', '2026-08-01T10:00:00.000Z');
    legacy.prepare(`
      INSERT INTO receipts(id, retailer_id, status, currency, declared_total_minor, import_key, created_at, updated_at)
      VALUES (?, ?, 'confirmed', 'EUR', ?, ?, ?, ?)
    `).run('receipt_legacy', 'retailer_legacy', 120, 'receipt-legacy-0001', '2026-08-01T10:00:00.000Z', '2026-08-01T10:00:00.000Z');
    legacy.prepare(`
      INSERT INTO receipt_extractions(id, receipt_id, provider, original_text, deterministic_json, ai_json, created_at)
      VALUES (?, ?, ?, ?, ?, NULL, ?)
    `).run('extraction_legacy', 'receipt_legacy', 'manual-or-embedded', 'LECHE ENTERA 1L 1,20', '{"items":[]}', '2026-08-01T10:00:00.000Z');
    legacy.prepare(`
      INSERT INTO receipt_items(
        id, receipt_id, original_description, normalized_description, product_variant_id,
        quantity, unit_price_minor, line_total_minor, discount_minor, status, confidence, match_reason, created_at
      ) VALUES (?, ?, ?, NULL, NULL, 1, 120, 120, 0, 'confirmed', 1, NULL, ?)
    `).run('receiptitem_legacy', 'receipt_legacy', 'Leche entera 1L', '2026-08-01T10:00:00.000Z');
  } finally {
    legacy.close();
  }

  const upgraded = new BasketraDatabase(databasePath, { migrationBackupDir });
  try {
    const products = upgraded.searchProducts('leche', 8);
    assert.equal(products.length, 1);
    assert.equal(upgraded.listPriceObservations(products[0]!.id)[0]?.priceMinor, 120);
    const projection = readProjection(databasePath, 'receipt_legacy');
    assert.equal(projection.item.description, 'Leche entera 1L');
    assert.equal(projection.item.productVariantId, products[0]!.id);
    assert.deepEqual(projection.listing, { retailerName: 'Mercadona', title: 'Leche entera 1L' });
    assert.deepEqual(projection.counts, { canonicalProducts: 1, variants: 1, prices: 1, receiptEvidence: 1 });
  } finally {
    upgraded.close();
    rmSync(root, { recursive: true, force: true });
  }
});
