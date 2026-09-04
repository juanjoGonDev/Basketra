import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { BasketraDatabase, CURRENT_SCHEMA_VERSION } from '../../src/infrastructure/database.ts';
import { FileStore } from '../../src/infrastructure/files.ts';
import { ReceiptExtractionService } from '../../src/receipts/service.ts';

function receipt(importKey: string, retailerName: string, storeName?: string, storeId?: string) {
  return {
    importKey,
    declaredTotalMinor: 120,
    originalText: 'LECHE 1,20',
    provider: 'test',
    retailerName,
    ...(storeName ? { storeName } : {}),
    ...(storeId ? { storeId } : {}),
    deterministic: { items: [] },
    items: [{
      description: 'LECHE', quantity: 1, unitPriceMinor: 120, lineTotalMinor: 120,
      status: 'confirmed', confidence: 1,
    }],
  } as const;
}

test('receipt confirmation reuses or creates an evidenced store and projects only new prices with it', () => {
  const root = mkdtempSync(join(tmpdir(), 'basketra-receipt-store-'));
  const path = join(root, 'basketra.db');
  const database = new BasketraDatabase(path);
  try {
    const existing = database.saveStore({ retailerName: 'Mercadona', name: 'Centro' });
    const firstId = database.importReceipt(receipt('receipt-store-0001', 'Mercadona', 'Centro', existing.id));
    const secondId = database.importReceipt(receipt('receipt-store-0002', 'Mercadona', 'Norte'));
    const thirdId = database.importReceipt(receipt('receipt-store-0003', 'Mercadona', 'Norte'));
    const raw = new DatabaseSync(path, { readOnly: true });
    try {
      const receipts = raw.prepare('SELECT id, store_id AS storeId FROM receipts ORDER BY import_key').all() as Array<{ id: string; storeId: string | null }>;
      const stores = raw.prepare("SELECT id, name FROM stores WHERE name = 'Norte' COLLATE NOCASE").all() as Array<{ id: string; name: string }>;
      const observations = raw.prepare(`
        SELECT price_observations.store_id AS storeId
        FROM price_observations
        JOIN receipt_items ON price_observations.id = 'price_receipt_' || receipt_items.id
        JOIN receipts ON receipts.id = receipt_items.receipt_id
        WHERE receipt_items.receipt_id IN (?, ?, ?)
        ORDER BY receipts.import_key
      `).all(firstId, secondId, thirdId) as Array<{ storeId: string | null }>;
      assert.equal(receipts.length, 3);
      assert.equal(receipts[0]?.storeId, existing.id);
      assert.equal(stores.length, 1);
      assert.ok(stores[0]?.id);
      assert.equal(receipts[1]?.storeId, stores[0]?.id);
      assert.equal(receipts[2]?.storeId, stores[0]?.id);
      assert.deepEqual(observations.map((row) => row.storeId), [existing.id, stores[0]?.id, stores[0]?.id]);
    } finally {
      raw.close();
    }
  } finally {
    database.close();
    rmSync(root, { recursive: true, force: true });
  }
});


test('store projection migration repairs receipt-derived prices that predate store assignment', () => {
  const root = mkdtempSync(join(tmpdir(), 'basketra-receipt-store-backfill-'));
  const path = join(root, 'basketra.db');
  const database = new BasketraDatabase(path);
  const store = database.saveStore({ retailerName: 'ALCAMPO', name: 'ALCAMPO ALMERIA' });
  const receiptId = database.importReceipt(receipt('receipt-store-backfill-0001', 'ALCAMPO', 'ALCAMPO ALMERIA', store.id));
  database.close();

  const legacy = new DatabaseSync(path);
  try {
    legacy.prepare(`
      UPDATE price_observations
      SET store_id = NULL
      WHERE id IN (
        SELECT 'price_receipt_' || receipt_items.id
        FROM receipt_items
        WHERE receipt_items.receipt_id = ?
      )
    `).run(receiptId);
    legacy.exec(`
      DROP TRIGGER IF EXISTS receipt_price_observation_write_store;
      DROP TRIGGER IF EXISTS confirmed_receipt_store_required_insert;
      DROP TRIGGER IF EXISTS confirmed_receipt_store_required_update;
    `);
    legacy.prepare('DELETE FROM schema_migrations WHERE version >= 13').run();
    const before = legacy.prepare(`
      SELECT receipts.store_id AS receiptStoreId, price_observations.store_id AS priceStoreId
      FROM receipt_items
      JOIN receipts ON receipts.id = receipt_items.receipt_id
      JOIN price_observations ON price_observations.id = 'price_receipt_' || receipt_items.id
      WHERE receipts.id = ?
    `).get(receiptId) as { receiptStoreId: string | null; priceStoreId: string | null };
    assert.equal(before.receiptStoreId, store.id);
    assert.equal(before.priceStoreId, null);
  } finally {
    legacy.close();
  }

  const migrated = new BasketraDatabase(path, {
    migrationBackupDir: join(root, 'migration-backups'),
    clock: () => new Date('2026-09-04T14:00:00.000Z'),
  });
  migrated.close();

  const repaired = new DatabaseSync(path, { readOnly: true });
  try {
    const schema = repaired.prepare('SELECT MAX(version) AS version FROM schema_migrations').get() as { version: number };
    const projection = repaired.prepare(`
      SELECT receipts.store_id AS receiptStoreId, price_observations.store_id AS priceStoreId
      FROM receipt_items
      JOIN receipts ON receipts.id = receipt_items.receipt_id
      JOIN price_observations ON price_observations.id = 'price_receipt_' || receipt_items.id
      WHERE receipts.id = ?
    `).get(receiptId) as { receiptStoreId: string | null; priceStoreId: string | null };
    assert.equal(CURRENT_SCHEMA_VERSION, 14);
    assert.equal(Number(schema.version), 14);
    assert.equal(projection.receiptStoreId, store.id);
    assert.equal(projection.priceStoreId, store.id);
    const storeProductCount = repaired.prepare(`
      SELECT COUNT(DISTINCT retailer_listings.product_variant_id) AS count
      FROM price_observations
      JOIN retailer_listings ON retailer_listings.id = price_observations.retailer_listing_id
      WHERE price_observations.store_id = ?
        AND retailer_listings.product_variant_id IS NOT NULL
    `).get(store.id) as { count: number };
    assert.equal(Number(storeProductCount.count), 1);
  } finally {
    repaired.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('receipt confirmation rejects an existing store from another retailer without writing a receipt', () => {
  const root = mkdtempSync(join(tmpdir(), 'basketra-receipt-store-mismatch-'));
  const path = join(root, 'basketra.db');
  const database = new BasketraDatabase(path);
  try {
    const store = database.saveStore({ retailerName: 'Mercadona', name: 'Centro' });
    assert.throws(
      () => database.importReceipt(receipt('receipt-store-0004', 'Alcampo', undefined, store.id)),
      /RECEIPT_STORE_RETAILER_MISMATCH/,
    );
    const raw = new DatabaseSync(path, { readOnly: true });
    try {
      assert.equal((raw.prepare('SELECT COUNT(*) AS count FROM receipts').get() as { count: number }).count, 0);
    } finally {
      raw.close();
    }
  } finally {
    database.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('AI receipt jobs persist the compact store snapshot used by direct and durable analysis', () => {
  const root = mkdtempSync(join(tmpdir(), 'basketra-receipt-store-snapshot-'));
  const path = join(root, 'basketra.db');
  const database = new BasketraDatabase(path);
  const fileStore = new FileStore(join(root, 'files'), join(root, 'tmp'), 1024 * 1024);
  const service = new ReceiptExtractionService(fileStore, () => ({
    async getCapabilities() { return { structuredOutput: true, jsonObject: true, image: true, pdf: true, internetSearch: false }; },
    async testConnection() { return { ok: true }; },
    async executeStructured() { throw new Error('NOT_USED'); },
    dispose() {},
  }), 0);
  try {
    const store = database.saveStore({ retailerName: 'Mercadona', name: 'Centro' });
    service.configureCategoryDatabase(path);
    const request = service.parseRequest({
      captures: [{ storageKey: `${'a'.repeat(64)}.png` }],
      verifyWithAi: true,
    });
    assert.deepEqual(request.storeInventory?.map((entry) => ({ ...entry })), [{
      id: store.id, name: 'Centro', retailerId: store.retailerId, retailerName: 'Mercadona',
    }]);
    const job = database.createReceiptExtractionJob(request);
    assert.deepEqual(
      (job.input as typeof request).storeInventory?.map((entry) => ({ ...entry })),
      request.storeInventory?.map((entry) => ({ ...entry })),
    );
  } finally {
    service.dispose();
    database.close();
    rmSync(root, { recursive: true, force: true });
  }
});


test('new receipt projections keep the resolved Store even without the migration-12 repair trigger', () => {
  const root = mkdtempSync(join(tmpdir(), 'basketra-receipt-store-direct-write-'));
  const path = join(root, 'basketra.db');
  const database = new BasketraDatabase(path);
  try {
    const writer = new DatabaseSync(path);
    try {
      writer.exec('DROP TRIGGER receipt_price_observation_assign_store;');
    } finally {
      writer.close();
    }

    const input = {
      importKey: 'receipt-store-direct-write-0001',
      declaredTotalMinor: 335,
      originalText: 'LECHE 1,20\nPAN 2,15',
      provider: 'test',
      retailerName: 'ALCAMPO',
      storeName: 'ALCAMPO ALMERIA',
      deterministic: { items: [] },
      items: [
        {
          description: 'LECHE ENTERA 1L',
          quantity: 1,
          unitPriceMinor: 120,
          lineTotalMinor: 120,
          status: 'confirmed',
          confidence: 1,
        },
        {
          description: 'PAN RUSTICO',
          quantity: 1,
          unitPriceMinor: 215,
          lineTotalMinor: 215,
          status: 'confirmed',
          confidence: 1,
        },
      ],
    } as const;

    const receiptId = database.importReceipt(input);
    assert.equal(database.importReceipt(input), receiptId);

    const raw = new DatabaseSync(path, { readOnly: true });
    try {
      const receiptRow = raw.prepare(`
        SELECT id, store_id AS storeId FROM receipts WHERE id = ?
      `).get(receiptId) as { id: string; storeId: string | null };
      assert.ok(receiptRow.storeId);

      const stores = raw.prepare(`
        SELECT id FROM stores
        WHERE retailer_id = (SELECT retailer_id FROM receipts WHERE id = ?)
          AND name = 'ALCAMPO ALMERIA' COLLATE NOCASE
      `).all(receiptId) as Array<{ id: string }>;
      assert.equal(stores.length, 1);
      assert.equal(stores[0]?.id, receiptRow.storeId);

      const projection = raw.prepare(`
        SELECT
          receipt_items.id AS receiptItemId,
          receipt_items.product_variant_id AS productVariantId,
          product_variants.canonical_product_id AS canonicalProductId,
          retailer_listings.id AS retailerListingId,
          retailer_listings.retailer_id AS listingRetailerId,
          price_observations.id AS priceObservationId,
          price_observations.retailer_listing_id AS observationListingId,
          price_observations.retailer_id AS observationRetailerId,
          price_observations.store_id AS observationStoreId
        FROM receipt_items
        JOIN product_variants ON product_variants.id = receipt_items.product_variant_id
        JOIN retailer_listings
          ON retailer_listings.product_variant_id = product_variants.id
         AND retailer_listings.retailer_id = (SELECT retailer_id FROM receipts WHERE id = receipt_items.receipt_id)
        JOIN external_evidence
          ON external_evidence.source_type = 'receipt'
         AND external_evidence.source_reference = 'receipt-item:' || receipt_items.id
        JOIN price_observations ON price_observations.evidence_id = external_evidence.id
        WHERE receipt_items.receipt_id = ?
        ORDER BY receipt_items.created_at, receipt_items.id
      `).all(receiptId) as Array<{
        receiptItemId: string;
        productVariantId: string | null;
        canonicalProductId: string;
        retailerListingId: string;
        listingRetailerId: string;
        priceObservationId: string;
        observationListingId: string;
        observationRetailerId: string;
        observationStoreId: string | null;
      }>;
      assert.equal(projection.length, 2);
      for (const row of projection) {
        assert.ok(row.productVariantId);
        assert.ok(row.canonicalProductId);
        assert.equal(row.observationListingId, row.retailerListingId);
        assert.equal(row.observationRetailerId, row.listingRetailerId);
        assert.equal(row.observationStoreId, receiptRow.storeId);
      }

      const counts = raw.prepare(`
        SELECT
          (SELECT COUNT(DISTINCT receipts.id) FROM receipts WHERE receipts.store_id = ?) AS ticketCount,
          (
            SELECT COUNT(DISTINCT retailer_listings.product_variant_id)
            FROM price_observations
            JOIN retailer_listings ON retailer_listings.id = price_observations.retailer_listing_id
            WHERE price_observations.store_id = ?
              AND retailer_listings.product_variant_id IS NOT NULL
          ) AS productCount,
          (SELECT COUNT(DISTINCT price_observations.id) FROM price_observations WHERE price_observations.store_id = ?) AS priceObservationCount
      `).get(receiptRow.storeId, receiptRow.storeId, receiptRow.storeId) as {
        ticketCount: number;
        productCount: number;
        priceObservationCount: number;
      };
      assert.deepEqual({ ...counts }, {
        ticketCount: 1,
        productCount: 2,
        priceObservationCount: 2,
      });
      assert.equal((raw.prepare('SELECT COUNT(*) AS count FROM canonical_products').get() as { count: number }).count, 2);
      assert.equal((raw.prepare('SELECT COUNT(*) AS count FROM product_variants').get() as { count: number }).count, 2);
      assert.equal((raw.prepare('SELECT COUNT(*) AS count FROM retailer_listings').get() as { count: number }).count, 2);
      assert.equal((raw.prepare('SELECT COUNT(*) AS count FROM price_observations').get() as { count: number }).count, 2);
    } finally {
      raw.close();
    }
  } finally {
    database.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('receipt confirmation requires a resolvable Store and leaves no partial projection', () => {
  const root = mkdtempSync(join(tmpdir(), 'basketra-receipt-store-required-'));
  const path = join(root, 'basketra.db');
  const database = new BasketraDatabase(path);
  try {
    assert.throws(
      () => database.importReceipt(receipt('receipt-store-required-0001', 'ALCAMPO')),
      /RECEIPT_STORE_REQUIRED/,
    );

    const raw = new DatabaseSync(path, { readOnly: true });
    try {
      const counts = raw.prepare(`
        SELECT
          (SELECT COUNT(*) FROM receipts) AS receipts,
          (SELECT COUNT(*) FROM receipt_items) AS items,
          (SELECT COUNT(*) FROM canonical_products) AS products,
          (SELECT COUNT(*) FROM product_variants) AS variants,
          (SELECT COUNT(*) FROM retailer_listings) AS listings,
          (SELECT COUNT(*) FROM price_observations) AS observations
      `).get() as Record<string, number>;
      assert.deepEqual({ ...counts }, {
        receipts: 0,
        items: 0,
        products: 0,
        variants: 0,
        listings: 0,
        observations: 0,
      });
    } finally {
      raw.close();
    }
  } finally {
    database.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('historical Store backfill changes only observations proven by receipt-item evidence', () => {
  const root = mkdtempSync(join(tmpdir(), 'basketra-receipt-store-backfill-scope-'));
  const path = join(root, 'basketra.db');
  const database = new BasketraDatabase(path);
  const store = database.saveStore({ retailerName: 'ALCAMPO', name: 'ALCAMPO ALMERIA' });
  const receiptId = database.importReceipt(receipt(
    'receipt-store-backfill-scope-0001',
    'ALCAMPO',
    'ALCAMPO ALMERIA',
    store.id,
  ));
  const product = database.searchProducts('LECHE', 8)[0];
  assert.ok(product);
  const manual = database.confirmPriceObservation({
    productVariantId: product.id,
    retailerName: 'ALCAMPO',
    priceMinor: 130,
    packageNumerator: 1,
    packageDenominator: 1,
    packageUnit: 'unit',
    observedAt: '2026-09-03T10:00:00.000Z',
    confidence: 1,
    evidence: { sourceType: 'manual', sourceReference: 'manual-store-backfill-scope' },
  });
  const photo = database.confirmPriceObservation({
    productVariantId: product.id,
    retailerName: 'ALCAMPO',
    priceMinor: 140,
    packageNumerator: 1,
    packageDenominator: 1,
    packageUnit: 'unit',
    observedAt: '2026-09-03T11:00:00.000Z',
    confidence: 1,
    evidence: { sourceType: 'product-photo', sourceReference: 'photo-store-backfill-scope' },
  });
  database.close();

  const legacy = new DatabaseSync(path);
  try {
    legacy.prepare(`
      UPDATE price_observations
      SET store_id = NULL
      WHERE evidence_id IN (
        SELECT external_evidence.id
        FROM external_evidence
        JOIN receipt_items
          ON external_evidence.source_type = 'receipt'
         AND external_evidence.source_reference = 'receipt-item:' || receipt_items.id
        WHERE receipt_items.receipt_id = ?
      )
    `).run(receiptId);
    legacy.exec(`
      DROP TRIGGER IF EXISTS receipt_price_observation_write_store;
      DROP TRIGGER IF EXISTS confirmed_receipt_store_required_insert;
      DROP TRIGGER IF EXISTS confirmed_receipt_store_required_update;
    `);
    legacy.prepare('DELETE FROM schema_migrations WHERE version >= 13').run();
  } finally {
    legacy.close();
  }

  const migrated = new BasketraDatabase(path, {
    migrationBackupDir: join(root, 'migration-backups'),
    clock: () => new Date('2026-09-04T14:30:00.000Z'),
  });
  migrated.close();

  const raw = new DatabaseSync(path, { readOnly: true });
  try {
    const receiptStores = raw.prepare(`
      SELECT price_observations.store_id AS storeId
      FROM price_observations
      JOIN external_evidence ON external_evidence.id = price_observations.evidence_id
      JOIN receipt_items
        ON external_evidence.source_type = 'receipt'
       AND external_evidence.source_reference = 'receipt-item:' || receipt_items.id
      WHERE receipt_items.receipt_id = ?
    `).all(receiptId) as Array<{ storeId: string | null }>;
    assert.ok(receiptStores.length > 0);
    assert.ok(receiptStores.every(row => row.storeId === store.id));

    const unrelated = raw.prepare(`
      SELECT id, store_id AS storeId FROM price_observations WHERE id IN (?, ?) ORDER BY id
    `).all(manual.id, photo.id) as Array<{ id: string; storeId: string | null }>;
    assert.deepEqual(unrelated.map(row => ({ ...row })), [
      { id: manual.id, storeId: null },
      { id: photo.id, storeId: null },
    ].sort((left, right) => left.id.localeCompare(right.id)));
  } finally {
    raw.close();
    rmSync(root, { recursive: true, force: true });
  }
});
