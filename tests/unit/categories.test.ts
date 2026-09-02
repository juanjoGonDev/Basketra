import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AI_CATEGORY_REFERENCE_PATTERN,
  AI_NEW_CATEGORY_ID_PATTERN,
  CATEGORY_COLOR_PATTERN,
  UNKNOWN_CATEGORY_COLOR,
  UNKNOWN_CATEGORY_ID,
  UNKNOWN_CATEGORY_NAME,
  assertCategoryParentReference,
  compactCategoryInventory,
  fallbackCategory,
  normalizeCategoryColor,
  normalizeCategoryName,
  normalizeOptionalCategoryColor,
} from '../../src/domain/categories.ts';

test('category constants and reference patterns describe persisted and temporary identities', () => {
  assert.equal(AI_CATEGORY_REFERENCE_PATTERN.test('category_abc123'), true);
  assert.equal(AI_CATEGORY_REFERENCE_PATTERN.test('new:fresh-food'), true);
  assert.equal(AI_CATEGORY_REFERENCE_PATTERN.test('invalid'), false);
  assert.equal(AI_NEW_CATEGORY_ID_PATTERN.test('new:fresh_food'), true);
  assert.equal(AI_NEW_CATEGORY_ID_PATTERN.test('category_abc123'), false);
  assert.equal(CATEGORY_COLOR_PATTERN.test('#12ABEF'), true);
  assert.equal(CATEGORY_COLOR_PATTERN.test('#12abef'), false);
});

test('category names collapse whitespace and reject empty or oversized values', () => {
  assert.equal(normalizeCategoryName('  Fruta   fresca  '), 'Fruta fresca');
  assert.throws(() => normalizeCategoryName('   '), /between 1 and 120/);
  assert.throws(() => normalizeCategoryName('x'.repeat(121)), /between 1 and 120/);
});

test('category colors are canonical uppercase hex and optional colors preserve absence', () => {
  assert.equal(normalizeCategoryColor(' #12abef '), '#12ABEF');
  assert.throws(() => normalizeCategoryColor('#12ABCG'), /#RRGGBB/);
  assert.equal(normalizeOptionalCategoryColor(undefined), undefined);
  assert.equal(normalizeOptionalCategoryColor(null), undefined);
  assert.equal(normalizeOptionalCategoryColor('   '), undefined);
  assert.equal(normalizeOptionalCategoryColor('#abcdef'), '#ABCDEF');
});

test('category parent references normalize valid ids and reject self or oversized ids', () => {
  assert.equal(assertCategoryParentReference('category_child'), undefined);
  assert.equal(assertCategoryParentReference('category_child', null), undefined);
  assert.equal(assertCategoryParentReference('category_child', '   '), undefined);
  assert.equal(assertCategoryParentReference('category_child', ' category_parent '), 'category_parent');
  assert.throws(
    () => assertCategoryParentReference('category_child', 'category_child'),
    /own parent/,
  );
  assert.throws(
    () => assertCategoryParentReference('category_child', 'x'.repeat(129)),
    /too long/,
  );
});

test('fallback category and compact AI inventory expose only classification fields', () => {
  assert.deepEqual(fallbackCategory(), {
    id: UNKNOWN_CATEGORY_ID,
    name: UNKNOWN_CATEGORY_NAME,
    color: UNKNOWN_CATEGORY_COLOR,
  });
  assert.equal(
    compactCategoryInventory([
      {
        id: 'category_food',
        name: 'Alimentación',
        color: '#112233',
        description: 'Not sent to the model inventory',
      },
      {
        id: 'category_dairy',
        name: 'Lácteos',
        parentId: 'category_food',
      },
    ]),
    JSON.stringify([
      { id: 'category_food', name: 'Alimentación', parentId: null, color: '#112233' },
      { id: 'category_dairy', name: 'Lácteos', parentId: 'category_food', color: null },
    ]),
  );
});
