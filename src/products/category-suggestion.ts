import { AiProviderError, type AiProvider } from '../ai/provider.ts';
import { StructuredAiExecutor, type RuntimeSchema } from '../ai/structured-executor.ts';
import { compactCategoryInventory, UNKNOWN_CATEGORY_ID } from '../domain/categories.ts';
import {
  asEnum,
  asOptionalString,
  asRecord,
  asSafeInteger,
  ValidationError,
} from '../domain/validation.ts';
import { UNIT_VALUES } from '../domain/units.ts';
import type { CategoryRepository } from '../infrastructure/category-repository.ts';

export const CATEGORY_SUGGESTION_SURFACES = [
  'inventory-product',
  'ticket-line',
  'shopping-product',
] as const;

export type CategorySuggestionContext = Readonly<{
  surface: typeof CATEGORY_SUGGESTION_SURFACES[number];
  canonicalName?: string;
  variantName?: string;
  description?: string;
  brand?: string;
  packageMinor?: number;
  packageUnit?: typeof UNIT_VALUES[number];
  quantity?: number;
  unit?: typeof UNIT_VALUES[number];
  unitPriceMinor?: number;
}>;

const CATEGORY_SUGGESTION_FIELDS = new Set([
  'surface',
  'canonicalName',
  'variantName',
  'description',
  'brand',
  'packageMinor',
  'packageUnit',
  'quantity',
  'unit',
  'unitPriceMinor',
]);

function assertClosedRequest(root: Record<string, unknown>): void {
  for (const key of Object.keys(root)) {
    if (!CATEGORY_SUGGESTION_FIELDS.has(key)) {
      throw new ValidationError('Unexpected category-suggestion field', `$.${key}`);
    }
  }
}

export function parseCategorySuggestionContext(value: unknown): CategorySuggestionContext {
  const root = asRecord(value);
  assertClosedRequest(root);
  const surface = asEnum(root['surface'], '$.surface', CATEGORY_SUGGESTION_SURFACES);
  const canonicalName = asOptionalString(root['canonicalName'], '$.canonicalName', { max: 160 });
  const variantName = asOptionalString(root['variantName'], '$.variantName', { max: 160 });
  const description = asOptionalString(root['description'], '$.description', { max: 500 });
  const brand = asOptionalString(root['brand'], '$.brand', { max: 120 });
  const packageMinor = root['packageMinor'] === undefined
    ? undefined
    : asSafeInteger(root['packageMinor'], '$.packageMinor', { min: 1, max: 100_000_000 });
  const packageUnit = root['packageUnit'] === undefined
    ? undefined
    : asEnum(root['packageUnit'], '$.packageUnit', UNIT_VALUES);
  const quantity = root['quantity'] === undefined
    ? undefined
    : asSafeInteger(root['quantity'], '$.quantity', { min: 1, max: 100_000 });
  const unit = root['unit'] === undefined ? undefined : asEnum(root['unit'], '$.unit', UNIT_VALUES);
  const unitPriceMinor = root['unitPriceMinor'] === undefined
    ? undefined
    : asSafeInteger(root['unitPriceMinor'], '$.unitPriceMinor', { min: 0, max: 100_000_000 });

  if (surface === 'ticket-line') {
    if (!description) throw new ValidationError('Product description is required', '$.description');
    if (quantity === undefined) throw new ValidationError('Positive quantity is required', '$.quantity');
    if (unitPriceMinor === undefined) throw new ValidationError('Valid unit price is required', '$.unitPriceMinor');
  } else {
    if (!canonicalName) throw new ValidationError('Canonical product name is required', '$.canonicalName');
    if (!variantName) throw new ValidationError('Product variant name is required', '$.variantName');
  }

  return {
    surface,
    ...(canonicalName ? { canonicalName } : {}),
    ...(variantName ? { variantName } : {}),
    ...(description ? { description } : {}),
    ...(brand ? { brand } : {}),
    ...(packageMinor === undefined ? {} : { packageMinor }),
    ...(packageUnit === undefined ? {} : { packageUnit }),
    ...(quantity === undefined ? {} : { quantity }),
    ...(unit === undefined ? {} : { unit }),
    ...(unitPriceMinor === undefined ? {} : { unitPriceMinor }),
  };
}

function categorySuggestionSchema(allowedIds: readonly string[]): RuntimeSchema<Readonly<{ categoryId: string | null }>> {
  const allowed = new Set(allowedIds);
  return {
    jsonSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['categoryId'],
      properties: {
        categoryId: {
          anyOf: [
            { type: 'string', enum: allowedIds },
            { type: 'null' },
          ],
        },
      },
    },
    parse(value: unknown) {
      if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        throw new AiProviderError('AI_INVALID_STRUCTURED_OUTPUT');
      }
      const categoryId = (value as Record<string, unknown>)['categoryId'];
      if (categoryId === null) return { categoryId: null };
      if (typeof categoryId !== 'string' || !allowed.has(categoryId)) {
        throw new AiProviderError('AI_INVALID_STRUCTURED_OUTPUT');
      }
      return { categoryId };
    },
  };
}

export async function suggestExistingCategory(input: Readonly<{
  categoryRepository: Pick<CategoryRepository, 'list'>;
  provider: AiProvider;
  maxRetries: number;
  context: CategorySuggestionContext;
  signal?: AbortSignal;
}>): Promise<Readonly<{ categoryId: string | null; attempts: number }>> {
  input.signal?.throwIfAborted();
  const categories = input.categoryRepository
    .list()
    .filter((category) => category.id !== UNKNOWN_CATEGORY_ID);
  if (categories.length === 0) return { categoryId: null, attempts: 0 };

  const ids = categories.map((category) => category.id);
  const executor = new StructuredAiExecutor(input.provider, input.maxRetries);
  const result = await executor.execute({
    operation: 'existing-category-suggestion',
    schemaName: 'existing_category_suggestion',
    reasoningEffort: 'low',
    systemPrompt: [
      'Choose the single best existing grocery category for the supplied product context.',
      'You may only return one category id present in the supplied category inventory, or null when there is no reliable match.',
      'Never invent, create, rename, recolor, reparent or otherwise mutate a category.',
    ].join(' '),
    content: JSON.stringify({
      context: input.context,
      categories: JSON.parse(compactCategoryInventory(categories)) as unknown,
    }),
    schema: categorySuggestionSchema(ids),
    ...(input.signal ? { signal: input.signal } : {}),
  });
  return { categoryId: result.value.categoryId, attempts: result.attempts };
}
