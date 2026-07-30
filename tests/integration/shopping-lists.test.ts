import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { BasketraDatabase, CURRENT_SCHEMA_VERSION } from '../../src/infrastructure/database.ts';

const fixturePath = join(dirname(fileURLToPath(import.meta.url)), '../fixtures/schema-v1.sql');

function createVersionOneFixture(path: string): void {
  const database = new DatabaseSync(path);
  try {
    database.exec(Buffer.from(readFileSync(fixturePath)).toString('utf8'));
  } finally {
    database.close();
  }
}

test('shopping list lifecycle is transactional and positions remain contiguous', () => {
  const root = mkdtempSync(join(tmpdir(), 'basketra-list-lifecycle-'));
  const databasePath = join(root, 'basketra.db');
  const database = new BasketraDatabase(databasePath);
  try {
    const list = database.createShoppingList('Semanal');
    const renamed = database.updateShoppingList(list.id, 'Compra semanal');
    assert.equal(renamed?.name, 'Compra semanal');
    assert.equal(database.updateShoppingList('missing', 'No existe'), undefined);

    const milk = database.addShoppingListItem({ listId: list.id, text: 'Leche', quantityMinor: 1, unit: 'l', exactRequired: true, substitutionAllowed: false });
    const rice = database.addShoppingListItem({ listId: list.id, text: 'Arroz', quantityMinor: 2, unit: 'kg', exactRequired: false, substitutionAllowed: true });
    const bread = database.addShoppingListItem({ listId: list.id, text: 'Pan', quantityMinor: 1, unit: 'unit', exactRequired: false, substitutionAllowed: true });

    const incremented = database.updateShoppingListItem({ listId: list.id, itemId: milk.id, quantityDelta: 2 });
    assert.equal(incremented.quantityMinor, 3);
    const completed = database.updateShoppingListItem({ listId: list.id, itemId: rice.id, completed: true });
    assert.equal(completed.completed, true);
    assert.match(completed.completedAt ?? '', /^\d{4}-/);
    const restored = database.updateShoppingListItem({ listId: list.id, itemId: rice.id, completed: false });
    assert.equal(restored.completed, false);
    assert.equal('completedAt' in restored, false);

    assert.throws(() => database.updateShoppingListItem({ listId: list.id, itemId: milk.id, quantityMinor: 2, quantityDelta: 1 }), /cannot be combined/);
    assert.throws(() => database.updateShoppingListItem({ listId: list.id, itemId: milk.id, quantityDelta: -3 }), /outside allowed limits/);
    assert.throws(() => database.updateShoppingListItem({ listId: list.id, itemId: 'missing', text: 'X' }), /SHOPPING_LIST_ITEM_NOT_FOUND/);

    const reordered = database.reorderShoppingListItems(list.id, [bread.id, milk.id, rice.id]);
    assert.deepEqual(reordered.map((item) => [item.id, item.position]), [[bread.id, 0], [milk.id, 1], [rice.id, 2]]);
    assert.throws(() => database.reorderShoppingListItems(list.id, [milk.id, rice.id]), /every current item exactly once/);
    assert.throws(() => database.reorderShoppingListItems(list.id, [milk.id, milk.id, rice.id]), /every current item exactly once/);

    database.deleteShoppingListItem(list.id, milk.id);
    assert.deepEqual(database.getShoppingList(list.id)?.items.map((item) => [item.id, item.position]), [[bread.id, 0], [rice.id, 1]]);
    assert.throws(() => database.deleteShoppingListItem(list.id, milk.id), /SHOPPING_LIST_ITEM_NOT_FOUND/);

    assert.equal(database.deleteShoppingList(list.id), true);
    assert.equal(database.deleteShoppingList(list.id), false);
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

test('version-one databases migrate completed state without changing existing rows', () => {
  const root = mkdtempSync(join(tmpdir(), 'basketra-list-upgrade-'));
  const databasePath = join(root, 'basketra.db');
  createVersionOneFixture(databasePath);

  const database = new BasketraDatabase(databasePath, { migrationBackupDir: join(root, 'migration-backups') });
  try {
    const legacy = database.getShoppingList('list_fixture');
    assert.equal(legacy?.items[0]?.completed, false);
    assert.equal(legacy?.items[0] && 'completedAt' in legacy.items[0], false);
    const itemId = legacy?.items[0]?.id;
    assert.ok(itemId);
    const completed = database.updateShoppingListItem({ listId: 'list_fixture', itemId, completed: true });
    assert.equal(completed.completed, true);
  } finally {
    database.close();
  }

  const raw = new DatabaseSync(databasePath, { readOnly: true });
  try {
    const version = raw.prepare('SELECT MAX(version) AS version FROM schema_migrations').get() as { version: number };
    assert.equal(version.version, CURRENT_SCHEMA_VERSION);
    const columns = raw.prepare('PRAGMA table_info(shopping_list_items)').all() as Array<{ name: string }>;
    assert.ok(columns.some((column) => column.name === 'completed'));
    assert.ok(columns.some((column) => column.name === 'completed_at'));
    const row = raw.prepare('SELECT completed, completed_at AS completedAt FROM shopping_list_items WHERE list_id = ?').get('list_fixture') as { completed: number; completedAt: string | null };
    assert.equal(row.completed, 1);
    assert.match(row.completedAt ?? '', /^\d{4}-/);
  } finally {
    raw.close();
    rmSync(root, { recursive: true, force: true });
  }
});
