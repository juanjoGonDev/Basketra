import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import {
  BasketraDatabase,
  CURRENT_SCHEMA_VERSION,
  ShoppingConflictError,
} from '../../src/infrastructure/database.ts';

const fixturePath = join(dirname(fileURLToPath(import.meta.url)), '../fixtures/schema-v1.sql');

function createVersionOneFixture(path: string): void {
  const database = new DatabaseSync(path);
  try {
    database.exec(Buffer.from(readFileSync(fixturePath)).toString('utf8'));
    database.prepare(`INSERT INTO shopping_list_items(
      id,
      list_id,
      text,
      quantity_minor,
      unit,
      exact_required,
      substitution_allowed,
      position,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      'legacy_item',
      'list_fixture',
      'Legacy milk',
      1,
      'unit',
      0,
      1,
      0,
      '2026-07-01T00:00:00.000Z',
      '2026-07-01T00:00:00.000Z',
    );
    database.prepare(`
      INSERT INTO canonical_products(id, name, category, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `).run('legacy_product', 'Leche', 'Lácteos', '2026-07-01T00:00:00.000Z', '2026-07-01T00:00:00.000Z');
    database.prepare(`
      INSERT INTO product_variants(id, canonical_product_id, name, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `).run('legacy_variant', 'legacy_product', 'Leche 1 L', '2026-07-01T00:00:00.000Z', '2026-07-01T00:00:00.000Z');
  } finally {
    database.close();
  }
}

test('shopping list lifecycle uses optimistic versions and positions remain contiguous', () => {
  const root = mkdtempSync(join(tmpdir(), 'basketra-list-lifecycle-'));
  const databasePath = join(root, 'basketra.db');
  const database = new BasketraDatabase(databasePath);
  try {
    const list = database.createShoppingList('Semanal');
    assert.equal(list.version, 1);
    const renamed = database.updateShoppingList(list.id, 'Compra semanal', list.version);
    assert.equal(renamed?.name, 'Compra semanal');
    assert.equal(renamed?.version, 2);
    assert.equal(database.updateShoppingList('missing', 'No existe', 1), undefined);

    const milk = database.addShoppingListItem({ listId: list.id, text: 'Leche', quantityMinor: 1, unit: 'l', exactRequired: true, substitutionAllowed: false });
    const rice = database.addShoppingListItem({ listId: list.id, text: 'Arroz', quantityMinor: 2, unit: 'kg', exactRequired: false, substitutionAllowed: true });
    const bread = database.addShoppingListItem({ listId: list.id, text: 'Pan', quantityMinor: 1, unit: 'unit', exactRequired: false, substitutionAllowed: true });
    assert.equal(milk.version, 1);
    assert.equal(database.getShoppingListVersion(list.id), 5);

    const incremented = database.updateShoppingListItem({ listId: list.id, itemId: milk.id, expectedVersion: milk.version, quantityDelta: 2 });
    assert.equal(incremented.quantityMinor, 3);
    assert.equal(incremented.version, 2);
    const completed = database.updateShoppingListItem({ listId: list.id, itemId: rice.id, expectedVersion: rice.version, completed: true });
    assert.equal(completed.completed, true);
    assert.equal(completed.version, 2);
    assert.match(completed.completedAt ?? '', /^\d{4}-/);
    const restored = database.updateShoppingListItem({ listId: list.id, itemId: rice.id, expectedVersion: completed.version, completed: false });
    assert.equal(restored.completed, false);
    assert.equal(restored.version, 3);
    assert.equal('completedAt' in restored, false);

    assert.throws(() => database.updateShoppingListItem({ listId: list.id, itemId: milk.id, expectedVersion: incremented.version, quantityMinor: 2, quantityDelta: 1 }), /cannot be combined/);
    assert.throws(() => database.updateShoppingListItem({ listId: list.id, itemId: milk.id, expectedVersion: incremented.version, quantityDelta: -3 }), /outside allowed limits/);
    assert.throws(() => database.updateShoppingListItem({ listId: list.id, itemId: 'missing', expectedVersion: 1, text: 'X' }), /SHOPPING_LIST_ITEM_NOT_FOUND/);

    assert.throws(
      () => database.updateShoppingListItem({ listId: list.id, itemId: milk.id, expectedVersion: milk.version, text: 'Leche stale' }),
      (error: unknown) => {
        assert.ok(error instanceof ShoppingConflictError);
        assert.equal(error.kind, 'item');
        assert.equal('version' in error.current ? error.current.version : undefined, incremented.version);
        return true;
      },
    );

    const listVersionBeforeOrder = database.getShoppingListVersion(list.id);
    assert.ok(listVersionBeforeOrder);
    const reordered = database.reorderShoppingListItems(list.id, [bread.id, milk.id, rice.id], listVersionBeforeOrder);
    assert.deepEqual(reordered.items.map((item) => [item.id, item.position]), [[bread.id, 0], [milk.id, 1], [rice.id, 2]]);
    assert.equal(reordered.list.version, listVersionBeforeOrder + 1);
    assert.throws(
      () => database.reorderShoppingListItems(list.id, [milk.id, bread.id, rice.id], listVersionBeforeOrder),
      (error: unknown) => error instanceof ShoppingConflictError && error.kind === 'reorder',
    );
    assert.throws(() => database.reorderShoppingListItems(list.id, [milk.id, rice.id], reordered.list.version), /every current item exactly once/);
    assert.throws(() => database.reorderShoppingListItems(list.id, [milk.id, milk.id, rice.id], reordered.list.version), /every current item exactly once/);

    database.deleteShoppingListItem(list.id, milk.id, incremented.version);
    assert.deepEqual(database.getShoppingList(list.id)?.items.map((item) => [item.id, item.position]), [[bread.id, 0], [rice.id, 1]]);
    assert.throws(() => database.deleteShoppingListItem(list.id, milk.id, incremented.version), /SHOPPING_LIST_ITEM_NOT_FOUND/);

    const currentVersion = database.getShoppingListVersion(list.id);
    assert.ok(currentVersion);
    assert.equal(database.deleteShoppingList(list.id, currentVersion), true);
    assert.equal(database.deleteShoppingList(list.id, currentVersion), false);
    assert.equal(database.getShoppingList(list.id), undefined);
  } finally {
    database.close();
  }

  const raw = new DatabaseSync(databasePath, { readOnly: true });
  try {
    assert.equal((raw.prepare('SELECT COUNT(*) AS count FROM shopping_list_items').get() as { count: number }).count, 0);
  } finally {
    raw.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('version-one databases migrate completion, collaboration and category data without losing legacy values', () => {
  const root = mkdtempSync(join(tmpdir(), 'basketra-list-upgrade-'));
  const databasePath = join(root, 'basketra.db');
  createVersionOneFixture(databasePath);

  const database = new BasketraDatabase(databasePath, { migrationBackupDir: join(root, 'migration-backups') });
  try {
    const legacy = database.getShoppingList('list_fixture');
    assert.equal(legacy?.list.version, 1);
    assert.equal(legacy?.items[0]?.version, 1);
    assert.equal(legacy?.items[0]?.completed, false);
    assert.equal(legacy?.items[0] && 'completedAt' in legacy.items[0], false);
    const itemId = legacy?.items[0]?.id;
    assert.ok(itemId);
    const completed = database.updateShoppingListItem({ listId: 'list_fixture', itemId, expectedVersion: 1, completed: true });
    assert.equal(completed.completed, true);
    assert.equal(completed.version, 2);

    const categories = database.listCategories();
    assert.equal(categories.length, 1);
    assert.equal(categories[0]?.name, 'Lácteos');
    const product = database.getProductVariant('legacy_variant');
    assert.equal(product?.categoryName, 'Lácteos');
  } finally {
    database.close();
  }

  const raw = new DatabaseSync(databasePath, { readOnly: true });
  try {
    const version = raw.prepare('SELECT MAX(version) AS version FROM schema_migrations').get() as { version: number };
    assert.equal(version.version, CURRENT_SCHEMA_VERSION);
    assert.equal(CURRENT_SCHEMA_VERSION, 4);
    const itemColumns = raw.prepare('PRAGMA table_info(shopping_list_items)').all() as Array<{ name: string }>;
    assert.ok(itemColumns.some((column) => column.name === 'completed'));
    assert.ok(itemColumns.some((column) => column.name === 'completed_at'));
    assert.ok(itemColumns.some((column) => column.name === 'version'));
    assert.ok(itemColumns.some((column) => column.name === 'product_variant_id'));
    const storeColumns = raw.prepare('PRAGMA table_info(stores)').all() as Array<{ name: string }>;
    assert.ok(storeColumns.some((column) => column.name === 'latitude_microdegrees'));
    assert.ok(storeColumns.some((column) => column.name === 'longitude_microdegrees'));
    const row = raw.prepare('SELECT completed, completed_at AS completedAt, version FROM shopping_list_items WHERE list_id = ?').get('list_fixture') as { completed: number; completedAt: string | null; version: number };
    assert.equal(row.completed, 1);
    assert.equal(row.version, 2);
    assert.match(row.completedAt ?? '', /^\d{4}-/);
    const migratedProduct = raw.prepare('SELECT category, category_id AS categoryId FROM canonical_products WHERE id = ?').get('legacy_product') as { category: string; categoryId: string | null };
    assert.equal(migratedProduct.category, 'Lácteos');
    assert.ok(migratedProduct.categoryId);
  } finally {
    raw.close();
    rmSync(root, { recursive: true, force: true });
  }
});
