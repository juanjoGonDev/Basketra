import type { MigrationDefinition } from './database.ts';
import { CATEGORY_MIGRATIONS } from './category-schema.ts';

const COLLABORATION_BASE_MIGRATIONS: readonly MigrationDefinition[] = [
  {
    version: 4,
    kind: 'safe',
    sql: `
      ALTER TABLE shopping_lists ADD COLUMN version INTEGER NOT NULL DEFAULT 1 CHECK(version > 0);
      ALTER TABLE shopping_list_items ADD COLUMN version INTEGER NOT NULL DEFAULT 1 CHECK(version > 0);
      ALTER TABLE shopping_list_items ADD COLUMN product_variant_id TEXT REFERENCES product_variants(id);

      CREATE TABLE product_categories(
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL COLLATE NOCASE UNIQUE,
        description TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      ALTER TABLE canonical_products ADD COLUMN category_id TEXT REFERENCES product_categories(id);
      ALTER TABLE canonical_products ADD COLUMN description TEXT;

      INSERT INTO product_categories(id, name, created_at, updated_at)
      SELECT
        'category_' || lower(hex(randomblob(16))),
        trim(category),
        MIN(created_at),
        MAX(updated_at)
      FROM canonical_products
      WHERE category IS NOT NULL AND trim(category) <> ''
      GROUP BY trim(category) COLLATE NOCASE;

      UPDATE canonical_products
      SET category_id = (
        SELECT product_categories.id
        FROM product_categories
        WHERE product_categories.name = trim(canonical_products.category) COLLATE NOCASE
        LIMIT 1
      )
      WHERE category IS NOT NULL AND trim(category) <> '';

      ALTER TABLE stores ADD COLUMN address TEXT;
      ALTER TABLE stores ADD COLUMN latitude_microdegrees INTEGER CHECK(latitude_microdegrees BETWEEN -90000000 AND 90000000);
      ALTER TABLE stores ADD COLUMN longitude_microdegrees INTEGER CHECK(longitude_microdegrees BETWEEN -180000000 AND 180000000);
      ALTER TABLE stores ADD COLUMN osm_type TEXT CHECK(osm_type IS NULL OR osm_type IN ('node','way','relation'));
      ALTER TABLE stores ADD COLUMN osm_id TEXT;

      CREATE INDEX shopping_list_items_product_variant_idx ON shopping_list_items(product_variant_id);
      CREATE INDEX canonical_products_category_idx ON canonical_products(category_id);
      CREATE INDEX retailer_listings_product_variant_idx ON retailer_listings(product_variant_id, retailer_id);
      CREATE UNIQUE INDEX stores_osm_identity_idx ON stores(osm_type, osm_id)
        WHERE osm_type IS NOT NULL AND osm_id IS NOT NULL;
    `,
  },
  {
    version: 5,
    kind: 'safe',
    sql: `
      CREATE TABLE receipt_extraction_jobs(
        id TEXT PRIMARY KEY,
        status TEXT NOT NULL CHECK(status IN ('queued', 'running', 'completed', 'failed', 'cancelled')),
        input_json TEXT NOT NULL,
        result_json TEXT,
        error_code TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        completed_at TEXT
      );
      CREATE INDEX receipt_extraction_jobs_updated_idx ON receipt_extraction_jobs(updated_at);
    `,
  },
  {
    version: 6,
    kind: 'safe',
    sql: `
      CREATE TABLE receipt_extraction_job_state(
        job_id TEXT PRIMARY KEY REFERENCES receipt_extraction_jobs(id) ON DELETE CASCADE,
        generation INTEGER NOT NULL CHECK(generation > 0),
        phase TEXT NOT NULL CHECK(phase IN ('queued','ocr_running','ai_pending','ai_running','completed','failed','cancelled')),
        deadline_at TEXT NOT NULL,
        page_count INTEGER NOT NULL CHECK(page_count > 0 AND page_count <= 20),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE receipt_extraction_job_pages(
        job_id TEXT NOT NULL REFERENCES receipt_extraction_jobs(id) ON DELETE CASCADE,
        position INTEGER NOT NULL CHECK(position >= 0 AND position < 20),
        ocr_json TEXT,
        idempotency_key TEXT UNIQUE,
        response_id TEXT UNIQUE,
        remote_status TEXT CHECK(remote_status IS NULL OR remote_status IN ('queued','in_progress','completed','failed','cancelled','incomplete')),
        remote_result_json TEXT,
        remote_error_code TEXT,
        updated_at TEXT NOT NULL,
        PRIMARY KEY(job_id, position)
      );

      CREATE INDEX receipt_extraction_job_state_phase_idx
        ON receipt_extraction_job_state(phase, updated_at);
      CREATE INDEX receipt_extraction_job_pages_response_idx
        ON receipt_extraction_job_pages(response_id)
        WHERE response_id IS NOT NULL;
    `,
  },
  {
    version: 7,
    kind: 'safe',
    sql: `
      UPDATE receipt_items AS item
      SET product_variant_id = COALESCE(
        (
          SELECT CASE
            WHEN COUNT(DISTINCT retailer_listings.product_variant_id) = 1
              THEN MIN(retailer_listings.product_variant_id)
          END
          FROM receipts
          JOIN retailer_listings ON retailer_listings.retailer_id = receipts.retailer_id
          WHERE receipts.id = item.receipt_id
            AND retailer_listings.product_variant_id IS NOT NULL
            AND retailer_listings.title = item.original_description COLLATE NOCASE
        ),
        (
          SELECT CASE WHEN COUNT(*) = 1 THEN MIN(product_variants.id) END
          FROM product_variants
          WHERE product_variants.name = item.original_description COLLATE NOCASE
            AND (
              SELECT COUNT(DISTINCT retailer_listings.product_variant_id)
              FROM receipts
              JOIN retailer_listings ON retailer_listings.retailer_id = receipts.retailer_id
              WHERE receipts.id = item.receipt_id
                AND retailer_listings.product_variant_id IS NOT NULL
                AND retailer_listings.title = item.original_description COLLATE NOCASE
            ) = 0
        )
      )
      WHERE item.status = 'confirmed' AND item.product_variant_id IS NULL;

      INSERT INTO canonical_products(id, name, category, category_id, description, created_at, updated_at)
      SELECT
        'product_receipt_' || receipt_items.id,
        receipt_items.original_description,
        NULL,
        NULL,
        NULL,
        receipts.created_at,
        receipts.created_at
      FROM receipt_items
      JOIN receipts ON receipts.id = receipt_items.receipt_id
      WHERE receipt_items.status = 'confirmed'
        AND receipt_items.product_variant_id IS NULL
        AND (
          (
            receipts.retailer_id IS NOT NULL
            AND NOT EXISTS (
              SELECT 1
              FROM retailer_listings
              WHERE retailer_listings.retailer_id = receipts.retailer_id
                AND retailer_listings.product_variant_id IS NOT NULL
                AND retailer_listings.title = receipt_items.original_description COLLATE NOCASE
            )
            AND NOT EXISTS (
              SELECT 1
              FROM receipt_items AS earlier_item
              JOIN receipts AS earlier_receipt ON earlier_receipt.id = earlier_item.receipt_id
              WHERE earlier_item.status = 'confirmed'
                AND earlier_item.product_variant_id IS NULL
                AND earlier_receipt.retailer_id = receipts.retailer_id
                AND earlier_item.original_description = receipt_items.original_description COLLATE NOCASE
                AND (
                  earlier_item.created_at < receipt_items.created_at
                  OR (earlier_item.created_at = receipt_items.created_at AND earlier_item.id < receipt_items.id)
                )
            )
          )
          OR (
            receipts.retailer_id IS NULL
            AND NOT EXISTS (
              SELECT 1
              FROM product_variants
              WHERE product_variants.name = receipt_items.original_description COLLATE NOCASE
            )
            AND NOT EXISTS (
              SELECT 1
              FROM receipt_items AS earlier_item
              JOIN receipts AS earlier_receipt ON earlier_receipt.id = earlier_item.receipt_id
              WHERE earlier_item.status = 'confirmed'
                AND earlier_item.product_variant_id IS NULL
                AND earlier_receipt.retailer_id IS NULL
                AND earlier_item.original_description = receipt_items.original_description COLLATE NOCASE
                AND (
                  earlier_item.created_at < receipt_items.created_at
                  OR (earlier_item.created_at = receipt_items.created_at AND earlier_item.id < receipt_items.id)
                )
            )
          )
          OR (
            receipts.retailer_id IS NOT NULL
            AND (
              SELECT COUNT(DISTINCT retailer_listings.product_variant_id)
              FROM retailer_listings
              WHERE retailer_listings.retailer_id = receipts.retailer_id
                AND retailer_listings.product_variant_id IS NOT NULL
                AND retailer_listings.title = receipt_items.original_description COLLATE NOCASE
            ) > 1
          )
          OR (
            receipts.retailer_id IS NULL
            AND (
              SELECT COUNT(*)
              FROM product_variants
              WHERE product_variants.name = receipt_items.original_description COLLATE NOCASE
            ) > 1
          )
        );

      INSERT INTO product_variants(
        id, canonical_product_id, name, brand, ean, package_minor, package_unit,
        dietary_tags_json, created_at, updated_at
      )
      SELECT
        'variant_receipt_' || receipt_items.id,
        'product_receipt_' || receipt_items.id,
        receipt_items.original_description,
        NULL,
        NULL,
        NULL,
        NULL,
        '[]',
        receipts.created_at,
        receipts.created_at
      FROM receipt_items
      JOIN receipts ON receipts.id = receipt_items.receipt_id
      WHERE receipt_items.status = 'confirmed'
        AND receipt_items.product_variant_id IS NULL
        AND EXISTS (
          SELECT 1
          FROM canonical_products
          WHERE canonical_products.id = 'product_receipt_' || receipt_items.id
        );

      INSERT INTO product_search(entity_id, name, aliases)
      SELECT
        'variant_receipt_' || receipt_items.id,
        receipt_items.original_description,
        ''
      FROM receipt_items
      WHERE receipt_items.status = 'confirmed'
        AND receipt_items.product_variant_id IS NULL
        AND EXISTS (
          SELECT 1
          FROM product_variants
          WHERE product_variants.id = 'variant_receipt_' || receipt_items.id
        );

      UPDATE receipt_items AS item
      SET product_variant_id = COALESCE(
        (
          SELECT (
            SELECT 'variant_receipt_' || anchor.id
            FROM receipt_items AS anchor
            JOIN receipts AS anchor_receipt ON anchor_receipt.id = anchor.receipt_id
            WHERE anchor.status = 'confirmed'
              AND anchor.product_variant_id IS NULL
              AND anchor_receipt.retailer_id = receipts.retailer_id
              AND anchor.original_description = item.original_description COLLATE NOCASE
              AND EXISTS (
                SELECT 1
                FROM product_variants
                WHERE product_variants.id = 'variant_receipt_' || anchor.id
              )
            ORDER BY anchor.created_at, anchor.id
            LIMIT 1
          )
          FROM receipts
          WHERE receipts.id = item.receipt_id
            AND receipts.retailer_id IS NOT NULL
            AND NOT EXISTS (
              SELECT 1
              FROM retailer_listings
              WHERE retailer_listings.retailer_id = receipts.retailer_id
                AND retailer_listings.product_variant_id IS NOT NULL
                AND retailer_listings.title = item.original_description COLLATE NOCASE
            )
        ),
        (
          SELECT CASE WHEN COUNT(*) = 1 THEN MIN(product_variants.id) END
          FROM product_variants
          WHERE product_variants.name = item.original_description COLLATE NOCASE
            AND (
              SELECT COUNT(DISTINCT retailer_listings.product_variant_id)
              FROM receipts
              JOIN retailer_listings ON retailer_listings.retailer_id = receipts.retailer_id
              WHERE receipts.id = item.receipt_id
                AND retailer_listings.product_variant_id IS NOT NULL
                AND retailer_listings.title = item.original_description COLLATE NOCASE
            ) = 0
        ),
        'variant_receipt_' || item.id
      )
      WHERE item.status = 'confirmed' AND item.product_variant_id IS NULL;

      INSERT INTO retailer_listings(
        id, retailer_id, product_variant_id, retailer_sku, title, source_url, created_at, updated_at
      )
      SELECT
        'listing_receipt_' || receipt_items.id,
        receipts.retailer_id,
        receipt_items.product_variant_id,
        NULL,
        receipt_items.original_description,
        NULL,
        receipts.created_at,
        receipts.created_at
      FROM receipt_items
      JOIN receipts ON receipts.id = receipt_items.receipt_id
      WHERE receipt_items.status = 'confirmed'
        AND receipts.retailer_id IS NOT NULL
        AND receipt_items.product_variant_id IS NOT NULL
        AND receipt_items.id = (
          SELECT candidate.id
          FROM receipt_items AS candidate
          JOIN receipts AS candidate_receipt ON candidate_receipt.id = candidate.receipt_id
          WHERE candidate.status = 'confirmed'
            AND candidate.product_variant_id = receipt_items.product_variant_id
            AND candidate_receipt.retailer_id = receipts.retailer_id
          ORDER BY candidate.created_at, candidate.id
          LIMIT 1
        )
        AND NOT EXISTS (
          SELECT 1
          FROM retailer_listings
          WHERE retailer_listings.retailer_id = receipts.retailer_id
            AND retailer_listings.product_variant_id = receipt_items.product_variant_id
        );

      INSERT INTO external_evidence(
        id, source_type, source_reference, observed_at, content_hash, metadata_json, created_at
      )
      SELECT
        'evidence_receipt_' || receipt_items.id,
        'receipt',
        'receipt-item:' || receipt_items.id,
        COALESCE(receipts.purchased_at, receipts.created_at),
        NULL,
        '{}',
        receipts.created_at
      FROM receipt_items
      JOIN receipts ON receipts.id = receipt_items.receipt_id
      WHERE receipt_items.status = 'confirmed'
        AND receipts.retailer_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1
          FROM external_evidence
          WHERE external_evidence.source_type = 'receipt'
            AND external_evidence.source_reference = 'receipt-item:' || receipt_items.id
        );

      INSERT INTO price_observations(
        id, retailer_listing_id, retailer_id, store_id, price_minor,
        package_numerator, package_denominator, package_unit,
        normalized_price_numerator, normalized_price_denominator,
        currency, stock_state, shipping_minor, promotion_json, conditions_json,
        evidence_id, observed_at, confidence, created_at
      )
      SELECT
        'price_receipt_' || receipt_items.id,
        (
          SELECT retailer_listings.id
          FROM retailer_listings
          WHERE retailer_listings.retailer_id = receipts.retailer_id
            AND retailer_listings.product_variant_id = receipt_items.product_variant_id
          ORDER BY retailer_listings.created_at, retailer_listings.id
          LIMIT 1
        ),
        receipts.retailer_id,
        NULL,
        receipt_items.unit_price_minor,
        1,
        1,
        'unit',
        receipt_items.unit_price_minor,
        1,
        'EUR',
        'unknown',
        0,
        '{}',
        '[]',
        external_evidence.id,
        COALESCE(receipts.purchased_at, receipts.created_at),
        receipt_items.confidence,
        receipts.created_at
      FROM receipt_items
      JOIN receipts ON receipts.id = receipt_items.receipt_id
      JOIN external_evidence
        ON external_evidence.source_type = 'receipt'
       AND external_evidence.source_reference = 'receipt-item:' || receipt_items.id
      WHERE receipt_items.status = 'confirmed'
        AND receipts.retailer_id IS NOT NULL
        AND receipt_items.product_variant_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1
          FROM price_observations
          WHERE price_observations.evidence_id = external_evidence.id
        );

      CREATE TRIGGER receipt_items_project_catalog
      AFTER INSERT ON receipt_items
      WHEN NEW.status = 'confirmed'
      BEGIN
        INSERT INTO canonical_products(id, name, category, category_id, description, created_at, updated_at)
        SELECT
          'product_receipt_' || NEW.id,
          NEW.original_description,
          NULL,
          NULL,
          NULL,
          receipts.created_at,
          receipts.created_at
        FROM receipts
        WHERE receipts.id = NEW.receipt_id
          AND (
            SELECT COUNT(DISTINCT retailer_listings.product_variant_id)
            FROM retailer_listings
            WHERE retailer_listings.retailer_id = receipts.retailer_id
              AND retailer_listings.product_variant_id IS NOT NULL
              AND retailer_listings.title = NEW.original_description COLLATE NOCASE
          ) <> 1
          AND (
            (
              SELECT COUNT(DISTINCT retailer_listings.product_variant_id)
              FROM retailer_listings
              WHERE retailer_listings.retailer_id = receipts.retailer_id
                AND retailer_listings.product_variant_id IS NOT NULL
                AND retailer_listings.title = NEW.original_description COLLATE NOCASE
            ) > 1
            OR (
              SELECT COUNT(*)
              FROM product_variants
              WHERE product_variants.name = NEW.original_description COLLATE NOCASE
            ) <> 1
          );

        INSERT INTO product_variants(
          id, canonical_product_id, name, brand, ean, package_minor, package_unit,
          dietary_tags_json, created_at, updated_at
        )
        SELECT
          'variant_receipt_' || NEW.id,
          'product_receipt_' || NEW.id,
          NEW.original_description,
          NULL,
          NULL,
          NULL,
          NULL,
          '[]',
          receipts.created_at,
          receipts.created_at
        FROM receipts
        WHERE receipts.id = NEW.receipt_id
          AND EXISTS (
            SELECT 1 FROM canonical_products WHERE id = 'product_receipt_' || NEW.id
          );

        INSERT INTO product_search(entity_id, name, aliases)
        SELECT 'variant_receipt_' || NEW.id, NEW.original_description, ''
        WHERE EXISTS (
          SELECT 1 FROM product_variants WHERE id = 'variant_receipt_' || NEW.id
        );

        UPDATE receipt_items
        SET product_variant_id = COALESCE(
          (
            SELECT CASE
              WHEN COUNT(DISTINCT retailer_listings.product_variant_id) = 1
                THEN MIN(retailer_listings.product_variant_id)
            END
            FROM receipts
            JOIN retailer_listings ON retailer_listings.retailer_id = receipts.retailer_id
            WHERE receipts.id = NEW.receipt_id
              AND retailer_listings.product_variant_id IS NOT NULL
              AND retailer_listings.title = NEW.original_description COLLATE NOCASE
          ),
          (
            SELECT CASE WHEN COUNT(*) = 1 THEN MIN(product_variants.id) END
            FROM product_variants
            WHERE product_variants.name = NEW.original_description COLLATE NOCASE
              AND product_variants.id <> 'variant_receipt_' || NEW.id
              AND (
                SELECT COUNT(DISTINCT retailer_listings.product_variant_id)
                FROM receipts
                JOIN retailer_listings ON retailer_listings.retailer_id = receipts.retailer_id
                WHERE receipts.id = NEW.receipt_id
                  AND retailer_listings.product_variant_id IS NOT NULL
                  AND retailer_listings.title = NEW.original_description COLLATE NOCASE
              ) = 0
          ),
          'variant_receipt_' || NEW.id
        )
        WHERE id = NEW.id AND product_variant_id IS NULL;

        INSERT INTO retailer_listings(
          id, retailer_id, product_variant_id, retailer_sku, title, source_url, created_at, updated_at
        )
        SELECT
          'listing_receipt_' || NEW.id,
          receipts.retailer_id,
          receipt_items.product_variant_id,
          NULL,
          NEW.original_description,
          NULL,
          receipts.created_at,
          receipts.created_at
        FROM receipts
        JOIN receipt_items ON receipt_items.id = NEW.id
        WHERE receipts.id = NEW.receipt_id
          AND receipts.retailer_id IS NOT NULL
          AND receipt_items.product_variant_id IS NOT NULL
          AND NOT EXISTS (
            SELECT 1
            FROM retailer_listings
            WHERE retailer_listings.retailer_id = receipts.retailer_id
              AND retailer_listings.product_variant_id = receipt_items.product_variant_id
          );

        INSERT INTO external_evidence(
          id, source_type, source_reference, observed_at, content_hash, metadata_json, created_at
        )
        SELECT
          'evidence_receipt_' || NEW.id,
          'receipt',
          'receipt-item:' || NEW.id,
          COALESCE(receipts.purchased_at, receipts.created_at),
          NULL,
          '{}',
          receipts.created_at
        FROM receipts
        WHERE receipts.id = NEW.receipt_id
          AND receipts.retailer_id IS NOT NULL
          AND NOT EXISTS (
            SELECT 1
            FROM external_evidence
            WHERE external_evidence.source_type = 'receipt'
              AND external_evidence.source_reference = 'receipt-item:' || NEW.id
          );

        INSERT INTO price_observations(
          id, retailer_listing_id, retailer_id, store_id, price_minor,
          package_numerator, package_denominator, package_unit,
          normalized_price_numerator, normalized_price_denominator,
          currency, stock_state, shipping_minor, promotion_json, conditions_json,
          evidence_id, observed_at, confidence, created_at
        )
        SELECT
          'price_receipt_' || NEW.id,
          (
            SELECT retailer_listings.id
            FROM retailer_listings
            WHERE retailer_listings.retailer_id = receipts.retailer_id
              AND retailer_listings.product_variant_id = receipt_items.product_variant_id
            ORDER BY retailer_listings.created_at, retailer_listings.id
            LIMIT 1
          ),
          receipts.retailer_id,
          NULL,
          NEW.unit_price_minor,
          1,
          1,
          'unit',
          NEW.unit_price_minor,
          1,
          'EUR',
          'unknown',
          0,
          '{}',
          '[]',
          external_evidence.id,
          COALESCE(receipts.purchased_at, receipts.created_at),
          NEW.confidence,
          receipts.created_at
        FROM receipts
        JOIN receipt_items ON receipt_items.id = NEW.id
        JOIN external_evidence
          ON external_evidence.source_type = 'receipt'
         AND external_evidence.source_reference = 'receipt-item:' || NEW.id
        WHERE receipts.id = NEW.receipt_id
          AND receipts.retailer_id IS NOT NULL
          AND receipt_items.product_variant_id IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM price_observations WHERE price_observations.evidence_id = external_evidence.id
          );
      END;
    `,
  },
  {
    version: 8,
    kind: 'safe',
    sql: `
      CREATE TABLE runtime_settings(
        id TEXT PRIMARY KEY CHECK(id = 'instance'),
        ai_base_url TEXT,
        ai_api_key TEXT,
        ai_model TEXT,
        ai_max_retries INTEGER NOT NULL CHECK(ai_max_retries BETWEEN 0 AND 10),
        overpass_base_url TEXT NOT NULL,
        max_body_bytes INTEGER NOT NULL CHECK(max_body_bytes BETWEEN 1024 AND 536870912),
        idle_hibernate_after_ms INTEGER NOT NULL CHECK(idle_hibernate_after_ms BETWEEN 0 AND 86400000),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      INSERT INTO runtime_settings(
        id, ai_base_url, ai_api_key, ai_model, ai_max_retries,
        overpass_base_url, max_body_bytes, idle_hibernate_after_ms,
        created_at, updated_at
      ) VALUES (
        'instance', NULL, NULL, NULL, 1,
        'https://overpass-api.de/api/', 33554432, 300000,
        CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      );
    `,
  },
] as const;

export const COLLABORATION_MIGRATIONS: readonly MigrationDefinition[] = [
  ...COLLABORATION_BASE_MIGRATIONS,
  ...CATEGORY_MIGRATIONS,
];
