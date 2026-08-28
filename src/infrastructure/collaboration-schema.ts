import type { MigrationDefinition } from './database.ts';

export const COLLABORATION_MIGRATIONS: readonly MigrationDefinition[] = [
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
] as const;
