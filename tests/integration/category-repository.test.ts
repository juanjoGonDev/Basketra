import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { UNKNOWN_CATEGORY_COLOR, UNKNOWN_CATEGORY_NAME } from '../../src/domain/categories.ts';
import { CategoryRepository } from '../../src/infrastructure/category-repository.ts';
import { BasketraDatabase, CURRENT_SCHEMA_VERSION } from '../../src/infrastructure/database.ts';

const FIXED_NOW = new Date('2026-09-02T12:00:00.000Z');

test('category migration and repository preserve an arbitrary-depth hierarchy with protected fallback', () => {
  const root = mkdtempSync(join(tmpdir(), 'basketra-categories-'));
  const database = new BasketraDatabase(join(root, 'basketra.db'), { clock: () => FIXED_NOW });
  const repository = new CategoryRepository(database.path, () => FIXED_NOW);

  try {
    assert.equal(CURRENT_SCHEMA_VERSION, 8);
    const unknown = repository.ensureUnknown();
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
