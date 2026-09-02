import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import {
  UNKNOWN_CATEGORY_COLOR,
  UNKNOWN_CATEGORY_ID,
  UNKNOWN_CATEGORY_NAME,
} from '../../src/domain/categories.ts';
import { CategoryRepository } from '../../src/infrastructure/category-repository.ts';
import { BasketraDatabase, CURRENT_SCHEMA_VERSION } from '../../src/infrastructure/database.ts';

const FIXED_NOW = new Date('2026-09-02T12:00:00.000Z');

test('category migration and repository preserve an arbitrary-depth hierarchy with protected fallback', () => {
  const root = mkdtempSync(join(tmpdir(), 'basketra-categories-'));
  const database = new BasketraDatabase(join(root, 'basketra.db'), { clock: () => FIXED_NOW });
  const repository = new CategoryRepository(database.path, () => FIXED_NOW);

  try {
    assert.equal(CURRENT_SCHEMA_VERSION, 9);
    const unknown = repository.ensureUnknown();
    assert.equal(unknown.id, UNKNOWN_CATEGORY_ID);
    assert.equal(unknown.name, UNKNOWN_CATEGORY_NAME);
    assert.equal(unknown.color, UNKNOWN_CATEGORY_COLOR);
    assert.equal(unknown.parentId, undefined);

    const food = repository.getOrCreate({ name: 'Alimentación', color: '#22aa44' });
    const chilled = repository.getOrCreate({
      name: 'Refrigerados',
      parentId: food.id,
      color: '#33BB55',
    });
    const dairy = repository.getOrCreate({
      name: 'Lácteos',
      parentId: chilled.id,
      color: '#44CC66',
      description: 'Leche, yogur y derivados',
    });

    assert.equal(food.color, '#22AA44');
    assert.equal(chilled.parentId, food.id);
    assert.equal(dairy.parentId, chilled.id);
    assert.equal(dairy.description, 'Leche, yogur y derivados');

    assert.throws(
      () => repository.update(food.id, {
        name: food.name,
        parentId: dairy.id,
        color: food.color,
      }),
      /PRODUCT_CATEGORY_CYCLE/,
    );
    assert.throws(
      () => repository.update(unknown.id, {
        name: 'Otros',
        color: unknown.color,
      }),
      /UNKNOWN_CATEGORY_PROTECTED/,
    );

    const unchangedFood = repository.get(food.id);
    assert.equal(unchangedFood?.parentId, undefined);
  } finally {
    database.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('category migration normalizes a legacy desconocido id without breaking references', () => {
  const root = mkdtempSync(join(tmpdir(), 'basketra-category-identity-'));
  const databasePath = join(root, 'basketra.db');
  const legacy = new DatabaseSync(databasePath);
  try {
    legacy.exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
      CREATE TABLE schema_migration_backups(
        backup_name TEXT PRIMARY KEY,
        from_version INTEGER NOT NULL CHECK(from_version >= 0),
        to_version INTEGER NOT NULL CHECK(to_version > from_version),
        bytes INTEGER NOT NULL CHECK(bytes > 0),
        created_at TEXT NOT NULL
      );
      CREATE TABLE product_categories(
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL COLLATE NOCASE UNIQUE,
        description TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        parent_id TEXT REFERENCES product_categories(id) CHECK(parent_id IS NULL OR parent_id <> id),
        color TEXT
      );
      CREATE TABLE canonical_products(
        id TEXT PRIMARY KEY,
        category_id TEXT REFERENCES product_categories(id)
      );
      CREATE TABLE receipt_items(
        id TEXT PRIMARY KEY,
        category_id TEXT REFERENCES product_categories(id)
      );
      INSERT INTO schema_migrations(version, applied_at) VALUES (8, '2026-09-02T00:00:00.000Z');
      INSERT INTO product_categories(id, name, parent_id, color, description, created_at, updated_at)
      VALUES ('category_legacy_unknown', 'desconocido', NULL, '#64748B', NULL, '2026-09-02T00:00:00.000Z', '2026-09-02T00:00:00.000Z');
      INSERT INTO product_categories(id, name, parent_id, color, description, created_at, updated_at)
      VALUES ('category_child', 'Sin clasificar hijo', 'category_legacy_unknown', '#AABBCC', NULL, '2026-09-02T00:00:00.000Z', '2026-09-02T00:00:00.000Z');
      INSERT INTO canonical_products(id, category_id) VALUES ('product_legacy', 'category_legacy_unknown');
      INSERT INTO receipt_items(id, category_id) VALUES ('receipt_item_legacy', 'category_legacy_unknown');
    `);
  } finally {
    legacy.close();
  }

  const database = new BasketraDatabase(databasePath, { clock: () => FIXED_NOW });
  database.close();

  const migrated = new DatabaseSync(databasePath, { readOnly: true });
  try {
    const unknown = migrated.prepare(`
      SELECT id, name, parent_id AS parentId, color
      FROM product_categories
      WHERE name = ? COLLATE NOCASE
    `).get(UNKNOWN_CATEGORY_NAME) as { id: string; name: string; parentId: string | null; color: string | null };
    assert.deepEqual(unknown, {
      id: UNKNOWN_CATEGORY_ID,
      name: UNKNOWN_CATEGORY_NAME,
      parentId: null,
      color: UNKNOWN_CATEGORY_COLOR,
    });
    assert.equal(
      (migrated.prepare('SELECT parent_id AS parentId FROM product_categories WHERE id = ?').get('category_child') as { parentId: string }).parentId,
      UNKNOWN_CATEGORY_ID,
    );
    assert.equal(
      (migrated.prepare('SELECT category_id AS categoryId FROM canonical_products WHERE id = ?').get('product_legacy') as { categoryId: string }).categoryId,
      UNKNOWN_CATEGORY_ID,
    );
    assert.equal(
      (migrated.prepare('SELECT category_id AS categoryId FROM receipt_items WHERE id = ?').get('receipt_item_legacy') as { categoryId: string }).categoryId,
      UNKNOWN_CATEGORY_ID,
    );
    assert.equal(
      (migrated.prepare('SELECT MAX(version) AS version FROM schema_migrations').get() as { version: number }).version,
      CURRENT_SCHEMA_VERSION,
    );
  } finally {
    migrated.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('AI category materialization creates referenced ancestors, reuses names and rolls back cycles', () => {
  const root = mkdtempSync(join(tmpdir(), 'basketra-ai-categories-'));
  const database = new BasketraDatabase(join(root, 'basketra.db'), { clock: () => FIXED_NOW });
  const repository = new CategoryRepository(database.path, () => FIXED_NOW);

  try {
    repository.ensureUnknown();
    const before = repository.list().length;
    const materialized = repository.materialize([
      {
        id: 'new:dairy',
        name: 'Lácteos',
        parentId: 'new:food',
        color: '#55AAFF',
      },
      {
        id: 'new:food',
        name: 'Alimentación',
        color: '#118844',
      },
    ]);

    const foodId = materialized.references.get('new:food');
    const dairyId = materialized.references.get('new:dairy');
    assert.ok(foodId);
    assert.ok(dairyId);
    assert.equal(repository.get(dairyId)?.parentId, foodId);
    assert.equal(materialized.created.length, 2);

    const reused = repository.materialize([
      {
        id: 'new:food-again',
        name: 'alimentación',
        color: '#FFFFFF',
      },
    ]);
    assert.equal(reused.references.get('new:food-again'), foodId);
    assert.equal(reused.created.length, 0);

    const stableCount = repository.list().length;
    assert.equal(stableCount, before + 2);
    assert.throws(
      () => repository.materialize([
        {
          id: 'new:a',
          name: 'Cycle A',
          parentId: 'new:b',
          color: '#112233',
        },
        {
          id: 'new:b',
          name: 'Cycle B',
          parentId: 'new:a',
          color: '#223344',
        },
      ]),
      /AI_CATEGORY_CYCLE/,
    );
    assert.equal(repository.list().length, stableCount);
  } finally {
    database.close();
    rmSync(root, { recursive: true, force: true });
  }
});
