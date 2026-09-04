import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { BasketraDatabase } from '../../src/infrastructure/database.ts';

test('ALCAMPO receipt persists the complete receipt-to-store projection chain', () => {
  const root = mkdtempSync(join(tmpdir(), 'basketra-receipt-store-proof-'));
  const path = join(root, 'basketra.db');
  const database = new BasketraDatabase(path);
  try {
    const receiptId = database.importReceipt({
      importKey: 'receipt-store-proof-0001',
      declaredTotalMinor: 335,
      originalText: 'LECHE ENTERA 1L 1,20\nPAN RUSTICO 2,15',
      provider: 'proof-fixture',
      retailerName: 'ALCAMPO',
      storeName: 'ALCAMPO ALMERIA',
      deterministic: { items: [] },
      items: [
        {
          description: 'LECHE ENTERA 1L', quantity: 1, unitPriceMinor: 120, lineTotalMinor: 120,
          status: 'confirmed', confidence: 1,
        },
        {
          description: 'PAN RUSTICO', quantity: 1, unitPriceMinor: 215, lineTotalMinor: 215,
          status: 'confirmed', confidence: 1,
        },
      ],
    });

    const raw = new DatabaseSync(path, { readOnly: true });
    try {
      const receipt = raw.prepare(`
        SELECT receipts.id, receipts.store_id AS storeId, receipts.retailer_id AS retailerId,
          stores.name AS storeName
        FROM receipts JOIN stores ON stores.id = receipts.store_id
        WHERE receipts.id = ?
      `).get(receiptId) as { id: string; storeId: string; retailerId: string; storeName: string };
      assert.equal(receipt.storeName, 'ALCAMPO ALMERIA');

      const rows = raw.prepare(`
        SELECT
          receipt_items.id AS receiptItemId,
          receipt_items.product_variant_id AS productVariantId,
          product_variants.canonical_product_id AS canonicalProductId,
          retailer_listings.id AS retailerListingId,
          retailer_listings.product_variant_id AS listingProductVariantId,
          retailer_listings.retailer_id AS listingRetailerId,
          price_observations.id AS priceObservationId,
          price_observations.retailer_listing_id AS observationListingId,
          price_observations.retailer_id AS observationRetailerId,
          price_observations.store_id AS observationStoreId
        FROM receipt_items
        JOIN product_variants ON product_variants.id = receipt_items.product_variant_id
        JOIN retailer_listings
          ON retailer_listings.product_variant_id = product_variants.id
         AND retailer_listings.retailer_id = ?
        JOIN external_evidence
          ON external_evidence.source_type = 'receipt'
         AND external_evidence.source_reference = 'receipt-item:' || receipt_items.id
        JOIN price_observations ON price_observations.evidence_id = external_evidence.id
        WHERE receipt_items.receipt_id = ?
        ORDER BY receipt_items.created_at, receipt_items.id
      `).all(receipt.retailerId, receiptId) as Array<{
        receiptItemId: string;
        productVariantId: string;
        canonicalProductId: string;
        retailerListingId: string;
        listingProductVariantId: string;
        listingRetailerId: string;
        priceObservationId: string;
        observationListingId: string;
        observationRetailerId: string;
        observationStoreId: string;
      }>;
      assert.equal(rows.length, 2);
      for (const row of rows) {
        assert.equal(row.listingProductVariantId, row.productVariantId);
        assert.equal(row.listingRetailerId, receipt.retailerId);
        assert.equal(row.observationListingId, row.retailerListingId);
        assert.equal(row.observationRetailerId, receipt.retailerId);
        assert.equal(row.observationStoreId, receipt.storeId);
      }

      const counts = raw.prepare(`
        SELECT
          (SELECT COUNT(DISTINCT receipts.id) FROM receipts WHERE receipts.store_id = ?) AS ticketCount,
          (SELECT COUNT(DISTINCT retailer_listings.product_variant_id)
             FROM price_observations
             JOIN retailer_listings ON retailer_listings.id = price_observations.retailer_listing_id
            WHERE price_observations.store_id = ? AND retailer_listings.product_variant_id IS NOT NULL) AS productCount,
          (SELECT COUNT(DISTINCT price_observations.id) FROM price_observations WHERE price_observations.store_id = ?) AS priceObservationCount
      `).get(receipt.storeId, receipt.storeId, receipt.storeId) as {
        ticketCount: number;
        productCount: number;
        priceObservationCount: number;
      };
      assert.deepEqual({ ...counts }, { ticketCount: 1, productCount: 2, priceObservationCount: 2 });

      const proof = {
        receipt: { id: receipt.id, storeId: receipt.storeId, retailerId: receipt.retailerId },
        store: { id: receipt.storeId, name: receipt.storeName },
        items: rows.map(row => ({
          receiptItemId: row.receiptItemId,
          productVariantId: row.productVariantId,
          canonicalProductId: row.canonicalProductId,
          retailerListingId: row.retailerListingId,
          listingProductVariantId: row.listingProductVariantId,
          listingRetailerId: row.listingRetailerId,
          priceObservationId: row.priceObservationId,
          observationListingId: row.observationListingId,
          observationRetailerId: row.observationRetailerId,
          observationStoreId: row.observationStoreId,
        })),
        counts: { ...counts },
      };
      process.stdout.write(`RECEIPT_STORE_DATABASE_PROOF ${JSON.stringify(proof)}\n`);
    } finally {
      raw.close();
    }
  } finally {
    database.close();
    rmSync(root, { recursive: true, force: true });
  }
});
