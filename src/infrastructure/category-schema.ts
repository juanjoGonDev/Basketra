import type { MigrationDefinition } from './database.ts';

export const CATEGORY_MIGRATIONS: readonly MigrationDefinition[] = [
  {
    version: 9,
    kind: 'safe',
    sql: `
      ALTER TABLE product_categories
        ADD COLUMN parent_id TEXT REFERENCES product_categories(id)
        CHECK(parent_id IS NULL OR parent_id <> id);
      ALTER TABLE product_categories
        ADD COLUMN color TEXT
        CHECK(
          color IS NULL
          OR (
            length(color) = 7
            AND substr(color, 1, 1) = '#'
            AND substr(color, 2, 6) NOT GLOB '*[^0-9A-F]*'
          )
        );
      ALTER TABLE receipt_items ADD COLUMN category_id TEXT REFERENCES product_categories(id);

      CREATE INDEX product_categories_parent_idx ON product_categories(parent_id);
      CREATE INDEX receipt_items_category_idx ON receipt_items(category_id);

      INSERT INTO product_categories(id, name, parent_id, color, description, created_at, updated_at)
      SELECT
        'category_unknown',
        'desconocido',
        NULL,
        '#64748B',
        NULL,
        strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
        strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE NOT EXISTS (
        SELECT 1 FROM product_categories WHERE name = 'desconocido' COLLATE NOCASE
      );

      UPDATE product_categories
      SET color = '#64748B'
      WHERE name = 'desconocido' COLLATE NOCASE AND color IS NULL;

      UPDATE receipt_items
      SET category_id = (
        SELECT id FROM product_categories WHERE name = 'desconocido' COLLATE NOCASE LIMIT 1
      )
      WHERE category_id IS NULL;
    `,
  },
  {
    version: 10,
    kind: 'safe',
    sql: `
      PRAGMA defer_foreign_keys = ON;

      UPDATE canonical_products
      SET category_id = 'category_unknown'
      WHERE category_id = (
        SELECT id
        FROM product_categories
        WHERE name = 'desconocido' COLLATE NOCASE
          AND id <> 'category_unknown'
        LIMIT 1
      );

      UPDATE receipt_items
      SET category_id = 'category_unknown'
      WHERE category_id = (
        SELECT id
        FROM product_categories
        WHERE name = 'desconocido' COLLATE NOCASE
          AND id <> 'category_unknown'
        LIMIT 1
      );

      UPDATE product_categories
      SET parent_id = 'category_unknown'
      WHERE parent_id = (
        SELECT id
        FROM product_categories
        WHERE name = 'desconocido' COLLATE NOCASE
          AND id <> 'category_unknown'
        LIMIT 1
      );

      UPDATE product_categories
      SET id = 'category_unknown',
          parent_id = NULL,
          color = COALESCE(color, '#64748B')
      WHERE name = 'desconocido' COLLATE NOCASE
        AND id <> 'category_unknown';
    `,
  },
] as const;
