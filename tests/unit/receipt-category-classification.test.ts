import test from 'node:test';
import assert from 'node:assert/strict';
import { UNKNOWN_CATEGORY_ID } from '../../src/domain/categories.ts';
import {
  buildReceiptCategoryContext,
  buildReceiptVerificationInstructions,
  RECEIPT_SCHEMA,
} from '../../src/receipts/extraction.ts';
import { resolveReceiptCategories } from '../../src/receipts/categories.ts';

type ReceiptJsonSchema = Readonly<{
  required: readonly string[];
  properties: Readonly<{
    items: Readonly<{
      items: Readonly<{ required: readonly string[] }>;
    }>;
  }>;
}>;

function baseInterpretation() {
  return {
    currency: 'EUR' as const,
    correctedText: 'LECHE 1,20',
    items: [{
      description: 'LECHE',
      quantity: 1,
      unitPriceMinor: 120,
      lineTotalMinor: 120,
      confidence: 0.95,
      categoryId: 'new:dairy',
      sourceLines: [1],
    }],
    newCategories: [{
      id: 'new:dairy',
      name: 'Lácteos',
      parentId: 'category_food',
      color: '#33AAFF',
    }],
    warnings: [],
  };
}

test('receipt structured schema requires categoryId and newCategories for provider output', () => {
  const schema = RECEIPT_SCHEMA.jsonSchema as ReceiptJsonSchema;
  assert.ok(schema.required.includes('newCategories'));
  assert.ok(schema.properties.items.items.required.includes('categoryId'));

  const parsed = RECEIPT_SCHEMA.parse(baseInterpretation());
  assert.equal(parsed.items[0]?.categoryId, 'new:dairy');
  assert.equal(parsed.newCategories[0]?.parentId, 'category_food');
  assert.equal(parsed.newCategories[0]?.color, '#33AAFF');
});

test('receipt parser keeps backward-compatible fallback for durable results created before categories', () => {
  const legacy = baseInterpretation();
  const parsed = RECEIPT_SCHEMA.parse({
    ...legacy,
    items: legacy.items.map(({ categoryId: _categoryId, ...item }) => item),
    newCategories: undefined,
  });
  assert.equal(parsed.items[0]?.categoryId, UNKNOWN_CATEGORY_ID);
  assert.deepEqual(parsed.newCategories, []);
});

test('receipt category context sends only the persisted classification inventory', () => {
  const context = buildReceiptCategoryContext([
    { id: 'category_food', name: 'Alimentación', color: '#118844', description: 'Internal detail' },
    { id: 'category_dairy', name: 'Lácteos', parentId: 'category_food', color: '#33AAFF' },
  ]);
  assert.match(context, /Available product categories/);
  assert.match(context, /"id":"category_dairy"/);
  assert.match(context, /"parentId":"category_food"/);
  assert.doesNotMatch(context, /Internal detail/);

  const instructions = buildReceiptVerificationInstructions({ pageCount: 2, pagePosition: 0 });
  assert.match(instructions, /Classify every product item using categoryId/);
  assert.match(instructions, /newCategories/);
  assert.match(instructions, /desconocido/);
  assert.match(instructions, /page 1 of 2/);
});

test('category resolver materializes only referenced proposals and falls back on invalid references', () => {
  const categories = [
    { id: 'category_unknown', name: 'desconocido', color: '#64748B', createdAt: '', updatedAt: '' },
    { id: 'category_food', name: 'Alimentación', color: '#118844', createdAt: '', updatedAt: '' },
  ];
  const created = [{
    id: 'category_dairy',
    name: 'Lácteos',
    parentId: 'category_food',
    color: '#33AAFF',
    createdAt: '',
    updatedAt: '',
  }];
  const materializedInputs: unknown[] = [];
  const store = {
    ensureUnknown: () => categories[0]!,
    list: () => categories,
    materialize: (proposals: readonly unknown[]) => {
      materializedInputs.push(proposals);
      return {
        references: new Map([['new:dairy', 'category_dairy']]),
        created,
      };
    },
  };
  const interpretation = {
    ...baseInterpretation(),
    newCategories: [
      ...baseInterpretation().newCategories,
      { id: 'new:unused', name: 'No usada', color: '#FFFFFF' },
    ],
  };
  const resolved = resolveReceiptCategories(interpretation, store);
  assert.equal(resolved.items[0]?.categoryId, 'category_dairy');
  assert.equal(resolved.newCategories.length, 1);
  assert.equal((materializedInputs[0] as readonly unknown[]).length, 1);

  const fallback = resolveReceiptCategories({
    ...interpretation,
    items: [{ ...interpretation.items[0]!, categoryId: 'category_missing' }],
    newCategories: [],
  }, store);
  assert.equal(fallback.items[0]?.categoryId, UNKNOWN_CATEGORY_ID);
  assert.match(fallback.warnings.join(' '), /desconocido/);
});
