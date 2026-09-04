import type { MigrationDefinition } from './database.ts';

export const INVENTORY_MIGRATIONS: readonly MigrationDefinition[] = [
  {
    version: 11,
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
  {
    version: 12,
    kind: 'safe',
    sql: `
      CREATE TRIGGER receipt_price_observation_assign_store
      AFTER INSERT ON price_observations
      WHEN NEW.id GLOB 'price_receipt_*'
      BEGIN
        UPDATE price_observations
        SET store_id = (
          SELECT receipts.store_id
          FROM receipts
          JOIN receipt_items ON receipt_items.receipt_id = receipts.id
          WHERE 'price_receipt_' || receipt_items.id = NEW.id
        )
        WHERE id = NEW.id
          AND EXISTS (
            SELECT 1
            FROM receipts
            JOIN receipt_items ON receipt_items.receipt_id = receipts.id
            WHERE 'price_receipt_' || receipt_items.id = NEW.id
              AND receipts.store_id IS NOT NULL
          );
      END;
    `,
  },
  {
    version: 13,
    kind: 'safe',
    sql: `
      UPDATE price_observations
      SET store_id = (
        SELECT receipts.store_id
        FROM external_evidence
        JOIN receipt_items
          ON external_evidence.source_type = 'receipt'
         AND external_evidence.source_reference = 'receipt-item:' || receipt_items.id
        JOIN receipts ON receipts.id = receipt_items.receipt_id
        WHERE external_evidence.id = price_observations.evidence_id
          AND receipts.store_id IS NOT NULL
      )
      WHERE price_observations.store_id IS NULL
        AND EXISTS (
          SELECT 1
          FROM external_evidence
          JOIN receipt_items
            ON external_evidence.source_type = 'receipt'
           AND external_evidence.source_reference = 'receipt-item:' || receipt_items.id
          JOIN receipts ON receipts.id = receipt_items.receipt_id
          WHERE external_evidence.id = price_observations.evidence_id
            AND receipts.store_id IS NOT NULL
        );
    `,
  },
] as const;
