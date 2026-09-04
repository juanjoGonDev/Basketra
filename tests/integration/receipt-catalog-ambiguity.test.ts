import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { BasketraDatabase } from '../../src/infrastructure/database.ts';

test('receipt projection does not guess between ambiguous exact retailer-title variants', () => {
  const root = mkdtempSync(join(tmpdir(), 'basketra-receipt-catalog-ambiguity-'));
  const databasePath = join(root, 'basketra.db');
  const database = new BasketraDatabase(databasePath, { clock: () => new Date('2026-09-01T10:00:00.000Z') });
  try {
    const first = database.createProduct({ canonicalName: 'Producto A', variantName: 'MISMO TEXTO TICKET' });
    const second = database.createProduct({ canonicalName: 'Producto B', variantName: 'MISMO TEXTO TICKET' });
    database.confirmPriceObservation({
      productVariantId: first.id,
      retailerName: 'Alcampo',
      priceMinor: 100,
      packageNumerator: 1,
      packageDenominator: 1,
      packageUnit: 'unit',
      observedAt: '2026-08-30T10:00:00.000Z',
      confidence: 1,
      evidence: { sourceType: 'manual', sourceReference: 'ambiguity-a' },
    });
    database.confirmPriceObservation({
      productVariantId: second.id,
      retailerName: 'Alcampo',
      priceMinor: 110,
      packageNumerator: 1,
      packageDenominator: 1,
      packageUnit: 'unit',
      observedAt: '2026-08-31T10:00:00.000Z',
      confidence: 1,
      evidence: { sourceType: 'manual', sourceReference: 'ambiguity-b' },
    });

    const receiptId = database.importReceipt({
      importKey: 'receipt-ambiguous-catalog-0001',
      declaredTotalMinor: 120,
      originalText: 'MISMO TEXTO TICKET 1,20',
      provider: 'manual-or-embedded',
      retailerName: 'Alcampo',
      storeName: 'Alcampo Centro',
      deterministic: { items: [{ description: 'MISMO TEXTO TICKET' }] },
      items: [{
        description: 'MISMO TEXTO TICKET',
        quantity: 1,
        unitPriceMinor: 120,
        lineTotalMinor: 120,
        status: 'confirmed',
        confidence: 1,
      }],
    });

    const raw = new DatabaseSync(databasePath, { readOnly: true });
    try {
      const row = raw.prepare(`
        SELECT product_variant_id AS productVariantId
        FROM receipt_items
        WHERE receipt_id = ?
      `).get(receiptId) as { productVariantId: string };
      assert.notEqual(row.productVariantId, first.id);
      assert.notEqual(row.productVariantId, second.id);
      assert.equal((raw.prepare(`
        SELECT COUNT(*) AS count
        FROM product_variants
        WHERE name = 'MISMO TEXTO TICKET' COLLATE NOCASE
      `).get() as { count: number }).count, 3);
    } finally {
      raw.close();
    }
  } finally {
    database.close();
    rmSync(root, { recursive: true, force: true });
  }
});
