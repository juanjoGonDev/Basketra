import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { BasketraDatabase } from '../../src/infrastructure/database.ts';
import { ShoppingConflictError } from '../../src/infrastructure/shopping-repository.ts';

test('bulk shopping-list mutations are atomic for completion, Store and deletion', () => {
  const root = mkdtempSync(join(tmpdir(), 'basketra-shopping-bulk-'));
  const database = new BasketraDatabase(join(root, 'basketra.db'), {
    clock: () => new Date('2026-09-05T20:00:00.000Z'),
  });
  try {
    const store = database.saveStore({ retailerName: 'Mercado', name: 'Mercado Centro' });
    const list = database.createShoppingList('Compra');
    const first = database.addShoppingListItem({
      listId: list.id,
      text: 'Leche',
      quantityMinor: 1,
      unit: 'unit',
      exactRequired: false,
      substitutionAllowed: true,
    });
    const second = database.addShoppingListItem({
      listId: list.id,
      text: 'Pan',
      quantityMinor: 1,
      unit: 'unit',
      exactRequired: false,
      substitutionAllowed: true,
    });

    assert.throws(
      () => database.bulkMutateShoppingListItems(list.id, [], { type: 'delete' }),
      /between 1 and 500/,
    );
    assert.throws(
      () => database.bulkMutateShoppingListItems(
        list.id,
        [
          { id: first.id, expectedVersion: first.version },
          { id: first.id, expectedVersion: first.version },
        ],
        { type: 'delete' },
      ),
      /duplicate items/,
    );
    assert.throws(
      () => database.bulkMutateShoppingListItems(
        list.id,
        [{ id: 'item_missing', expectedVersion: 1 }],
        { type: 'delete' },
      ),
      /SHOPPING_LIST_ITEM_NOT_FOUND/,
    );

    const completed = database.bulkMutateShoppingListItems(
      list.id,
      [
        { id: first.id, expectedVersion: first.version },
        { id: second.id, expectedVersion: second.version },
      ],
      { type: 'completed', completed: true },
    );
    assert.equal(completed.items.filter((item) => item.completed).length, 2);

    const currentFirst = completed.items.find((item) => item.id === first.id)!;
    const currentSecond = completed.items.find((item) => item.id === second.id)!;
    const stored = database.bulkMutateShoppingListItems(
      list.id,
      [
        { id: currentFirst.id, expectedVersion: currentFirst.version },
        { id: currentSecond.id, expectedVersion: currentSecond.version },
      ],
      { type: 'store', storeOverrideId: store.id },
    );
    assert.deepEqual(stored.items.map((item) => item.storeOverrideId), [store.id, store.id]);

    const inherited = database.bulkMutateShoppingListItems(
      list.id,
      stored.items.map((item) => ({ id: item.id, expectedVersion: item.version })),
      { type: 'store', storeOverrideId: null },
    );
    assert.deepEqual(inherited.items.map((item) => item.storeOverrideId), [undefined, undefined]);

    const pending = database.bulkMutateShoppingListItems(
      list.id,
      inherited.items.map((item) => ({ id: item.id, expectedVersion: item.version })),
      { type: 'completed', completed: false },
    );
    assert.equal(pending.items.filter((item) => item.completed).length, 0);

    const staleFirst = pending.items.find((item) => item.id === first.id)!;
    const staleSecond = pending.items.find((item) => item.id === second.id)!;
    const changedSecond = database.updateShoppingListItem({
      listId: list.id,
      itemId: staleSecond.id,
      expectedVersion: staleSecond.version,
      completed: false,
    });
    assert.throws(
      () => database.bulkMutateShoppingListItems(
        list.id,
        [
          { id: staleFirst.id, expectedVersion: staleFirst.version },
          { id: staleSecond.id, expectedVersion: staleSecond.version },
        ],
        { type: 'delete' },
      ),
      (error: unknown) => error instanceof ShoppingConflictError,
    );
    const afterConflict = database.getShoppingList(list.id)!;
    assert.equal(afterConflict.items.length, 2);
    assert.ok(afterConflict.items.some((item) => item.id === staleFirst.id));
    assert.ok(afterConflict.items.some((item) => item.id === changedSecond.id));

    const latestFirst = afterConflict.items.find((item) => item.id === first.id)!;
    const latestSecond = afterConflict.items.find((item) => item.id === second.id)!;
    const deleted = database.bulkMutateShoppingListItems(
      list.id,
      [
        { id: latestFirst.id, expectedVersion: latestFirst.version },
        { id: latestSecond.id, expectedVersion: latestSecond.version },
      ],
      { type: 'delete' },
    );
    assert.equal(deleted.items.length, 0);
    assert.deepEqual(deleted.affectedItemIds.sort(), [first.id, second.id].sort());
  } finally {
    database.close();
    rmSync(root, { recursive: true, force: true });
  }
});
