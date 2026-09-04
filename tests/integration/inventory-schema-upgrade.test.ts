import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { BasketraDatabase, CURRENT_SCHEMA_VERSION } from '../../src/infrastructure/database.ts';

const fixturePath = join(dirname(fileURLToPath(import.meta.url)), '../fixtures/schema-v1.sql');

function createLegacyReceiptFixture(databasePath: string): void {
  const database = new DatabaseSync(databasePath);
  try {
    database.exec(Buffer.from(readFileSync(fixturePath)).toString('utf8'));
    database.prepare(`
      INSERT INTO receipts(id, retailer_id, status, currency, declared_total_minor, import_key, purchased_at, created_at, updated_at)
      VALUES (?, NULL, 'confirmed', 'EUR', 350, ?, ?, ?, ?)
    `).run(
      'receipt_inventory_upgrade',
      'inventory-upgrade-receipt',
      '2026-07-01T10:30:00.000Z',
      '2026-07-01T10:31:00.000Z',
      '2026-07-01T10:31:00.000Z',
    );
    database.prepare(`
      INSERT INTO receipt_items(
        id, receipt_id, original_description, normalized_description, product_variant_id,
        quantity, unit_price_minor, line_total_minor, discount_minor, status, confidence, match_reason, created_at
      ) VALUES (?, ?, ?, ?, NULL, 1, 350, 350, 0, 'confirmed', 1, 'legacy-fixture', ?)
    `).run(
      'receipt_item_inventory_upgrade',
      'receipt_inventory_upgrade',
      'Producto legado',
      'Producto legado',
      '2026-07-01T10:31:00.000Z',
    );
  } finally {
    database.close();
  }
}

test('inventory schema upgrade preserves legacy receipt rows and initializes editable history fields', () => {
  const root = mkdtempSync(join(tmpdir(), 'basketra-inventory-schema-upgrade-'));
  const databasePath = join(root, 'basketra.db');
  createLegacyReceiptFixture(databasePath);

  const migrated = new BasketraDatabase(databasePath, {
    migrationBackupDir: join(root, 'migration-backups'),
    clock: () => new Date('2026-09-02T12:00:00.000Z'),
  });
  migrated.close();

  const database = new DatabaseSync(databasePath, { readOnly: true });
  try {
    const schema = database.prepare('SELECT MAX(version) AS version FROM schema_migrations').get() as { version: number };
    assert.equal(Number(schema.version), CURRENT_SCHEMA_VERSION);
    assert.equal(CURRENT_SCHEMA_VERSION, 13);

    const receipt = database.prepare(`
      SELECT id, declared_total_minor AS declaredTotalMinor, purchased_at AS purchasedAt,
        store_id AS storeId, payment_status AS paymentStatus, payment_method AS paymentMethod,
        notes, tax_minor AS taxMinor, receipt_discount_minor AS receiptDiscountMinor
      FROM receipts WHERE id = ?
    `).get('receipt_inventory_upgrade') as {
      id: string;
      declaredTotalMinor: number;
      purchasedAt: string;
      storeId: string | null;
      paymentStatus: string;
      paymentMethod: string | null;
      notes: string | null;
      taxMinor: number;
      receiptDiscountMinor: number;
    };
    assert.deepEqual({ ...receipt }, {
      id: 'receipt_inventory_upgrade',
      declaredTotalMinor: 350,
      purchasedAt: '2026-07-01T10:30:00.000Z',
      storeId: null,
      paymentStatus: 'paid',
      paymentMethod: null,
      notes: null,
      taxMinor: 0,
      receiptDiscountMinor: 0,
    });

    const item = database.prepare(`
      SELECT id, original_description AS originalDescription, status, unit,
        discount_type AS discountType, discount_value AS discountValue,
        discount_quantity AS discountQuantity, line_total_minor AS lineTotalMinor
      FROM receipt_items WHERE id = ?
    `).get('receipt_item_inventory_upgrade') as {
      id: string;
      originalDescription: string;
      status: string;
      unit: string;
      discountType: string;
      discountValue: number;
      discountQuantity: number;
      lineTotalMinor: number;
    };
    assert.deepEqual({ ...item }, {
      id: 'receipt_item_inventory_upgrade',
      originalDescription: 'Producto legado',
      status: 'confirmed',
      unit: 'unit',
      discountType: 'amount',
      discountValue: 0,
      discountQuantity: 1,
      lineTotalMinor: 350,
    });
  } finally {
    database.close();
    rmSync(root, { recursive: true, force: true });
  }
});
