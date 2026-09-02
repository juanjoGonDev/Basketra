import type { MigrationDefinition } from './database.ts';

export const INVENTORY_MIGRATIONS: readonly MigrationDefinition[] = [
  {
    version: 10,
    kind: 'safe',
    sql: `
      ALTER TABLE receipts ADD COLUMN store_id TEXT REFERENCES stores(id);
      ALTER TABLE receipts ADD COLUMN payment_status TEXT NOT NULL DEFAULT 'paid'
        CHECK(payment_status IN ('paid','pending','cancelled'));
      ALTER TABLE receipts ADD COLUMN payment_method TEXT;
      ALTER TABLE receipts ADD COLUMN notes TEXT;
      ALTER TABLE receipts ADD COLUMN tax_minor INTEGER NOT NULL DEFAULT 0 CHECK(tax_minor >= 0);
      ALTER TABLE receipts ADD COLUMN receipt_discount_minor INTEGER NOT NULL DEFAULT 0 CHECK(receipt_discount_minor >= 0);

      ALTER TABLE receipt_items ADD COLUMN unit TEXT NOT NULL DEFAULT 'unit';
      ALTER TABLE receipt_items ADD COLUMN discount_type TEXT NOT NULL DEFAULT 'amount'
        CHECK(discount_type IN ('amount','percentage'));
      ALTER TABLE receipt_items ADD COLUMN discount_value INTEGER NOT NULL DEFAULT 0 CHECK(discount_value >= 0);
      ALTER TABLE receipt_items ADD COLUMN discount_quantity INTEGER NOT NULL DEFAULT 1 CHECK(discount_quantity > 0);

      UPDATE receipt_items
      SET discount_type = 'amount', discount_value = discount_minor
      WHERE discount_minor > 0;

      CREATE INDEX receipts_store_purchased_idx
        ON receipts(store_id, purchased_at DESC, created_at DESC);
      CREATE INDEX receipts_purchased_idx
        ON receipts(purchased_at DESC, created_at DESC);
    `,
  },
] as const;
