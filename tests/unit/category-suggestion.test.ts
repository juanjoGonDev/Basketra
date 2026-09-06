import test from 'node:test';
import assert from 'node:assert/strict';
import type { AiProvider, AiStructuredInput } from '../../src/ai/provider.ts';
import { AiProviderError } from '../../src/ai/provider.ts';
import { UNKNOWN_CATEGORY_ID } from '../../src/domain/categories.ts';
import type { CategoryRepository, ProductCategoryRecord } from '../../src/infrastructure/category-repository.ts';
import {
  parseCategorySuggestionContext,
  suggestExistingCategory,
} from '../../src/products/category-suggestion.ts';

function category(id: string, name: string, parentId?: string): ProductCategoryRecord {
  return {
    id,
    name,
    ...(parentId ? { parentId } : {}),
    createdAt: '2026-09-06T00:00:00.000Z',
    updatedAt: '2026-09-06T00:00:00.000Z',
  };
}

function repository(categories: readonly ProductCategoryRecord[]): Pick<CategoryRepository, 'list'> {
  return { list: () => [...categories] };
}

function provider(result: unknown, observed: AiStructuredInput[]): AiProvider {
  return {
    async getCapabilities() {
      return { structuredOutput: true, jsonObject: true, image: true, pdf: false, internetSearch: false };
    },
    async testConnection() {
      return { ok: true };
    },
    async executeStructured(input) {
      observed.push(input);
      return result;
    },
    dispose() {},
  };
}

test('existing category suggestion uses low reasoning and server-owned categories without the protected fallback', async () => {
  const observed: AiStructuredInput[] = [];
  const result = await suggestExistingCategory({
    categoryRepository: repository([
      category(UNKNOWN_CATEGORY_ID, 'desconocido'),
      category('category_food', 'Alimentación'),
      category('category_dairy', 'Lácteos', 'category_food'),
    ]),
    provider: provider({ categoryId: 'category_dairy' }, observed),
    maxRetries: 1,
    context: parseCategorySuggestionContext({
      surface: 'inventory-product',
      canonicalName: 'Leche',
      variantName: 'Leche entera 1 L',
      brand: 'Marca',
    }),
  });

  assert.deepEqual(result, { categoryId: 'category_dairy', attempts: 1 });
  assert.equal(observed.length, 1);
  assert.equal(observed[0]!.operation, 'existing-category-suggestion');
  assert.equal(observed[0]!.reasoningEffort, 'low');
  assert.match(String(observed[0]!.content), /category_dairy/u);
  assert.doesNotMatch(String(observed[0]!.content), new RegExp(UNKNOWN_CATEGORY_ID, 'u'));
  assert.deepEqual(
    ((observed[0]!.jsonSchema.properties as Record<string, unknown>)['categoryId'] as { anyOf: Array<{ enum?: string[] }> }).anyOf[0]!.enum,
    ['category_food', 'category_dairy'],
  );
});

test('category suggestion request parser rejects client-owned inventories and missing surface context', () => {
  assert.throws(
    () => parseCategorySuggestionContext({
      surface: 'shopping-product',
      canonicalName: 'Arroz',
      variantName: 'Arroz largo',
      categories: [{ id: 'category_fake', name: 'Fake' }],
    }),
    /Unexpected category-suggestion field/u,
  );
  assert.throws(
    () => parseCategorySuggestionContext({
      surface: 'ticket-line',
      description: 'Arroz',
      quantity: 1,
    }),
    /unit price/u,
  );
});

test('unknown AI category ids fail closed as invalid structured output', async () => {
  const observed: AiStructuredInput[] = [];
  await assert.rejects(
    () => suggestExistingCategory({
      categoryRepository: repository([category('category_food', 'Alimentación')]),
      provider: provider({ categoryId: 'category_not_grounded' }, observed),
      maxRetries: 0,
      context: parseCategorySuggestionContext({
        surface: 'shopping-product',
        canonicalName: 'Arroz',
        variantName: 'Arroz largo',
      }),
    }),
    (error: unknown) => error instanceof AiProviderError && error.code === 'AI_INVALID_STRUCTURED_OUTPUT',
  );
  assert.equal(observed.length, 1);
});

test('empty useful category inventory returns no match without calling the AI provider', async () => {
  const observed: AiStructuredInput[] = [];
  const result = await suggestExistingCategory({
    categoryRepository: repository([category(UNKNOWN_CATEGORY_ID, 'desconocido')]),
    provider: provider({ categoryId: UNKNOWN_CATEGORY_ID }, observed),
    maxRetries: 0,
    context: parseCategorySuggestionContext({
      surface: 'inventory-product',
      canonicalName: 'Leche',
      variantName: 'Leche entera',
    }),
  });
  assert.deepEqual(result, { categoryId: null, attempts: 0 });
  assert.equal(observed.length, 0);
});
