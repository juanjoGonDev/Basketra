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
] as const;
