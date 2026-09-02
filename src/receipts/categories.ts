import {
  AI_NEW_CATEGORY_ID_PATTERN,
  UNKNOWN_CATEGORY_COLOR,
  type AiCategoryProposal,
  type CategoryDescriptor,
} from '../domain/categories.ts';
import { CategoryRepository, type ProductCategoryRecord } from '../infrastructure/category-repository.ts';
import type { AiReceiptInterpretation, ReceiptExtractionItem } from './extraction.ts';

const CATEGORY_FALLBACK_WARNING = 'Some receipt items could not be assigned to a valid category and were classified as desconocido.';
const CATEGORY_SEMANTIC_MATERIALIZATION_ERRORS = new Set([
  'AI_CATEGORY_REFERENCE_INVALID',
  'AI_CATEGORY_REFERENCE_DUPLICATED',
  'AI_CATEGORY_PARENT_NOT_FOUND',
  'AI_CATEGORY_CYCLE',
]);

type CategoryStore = Pick<CategoryRepository, 'ensureUnknown' | 'list' | 'materialize'>;

function referencedProposals(
  items: readonly ReceiptExtractionItem[],
  proposals: readonly AiCategoryProposal[],
): readonly AiCategoryProposal[] {
  const byId = new Map(proposals.map((proposal) => [proposal.id, proposal]));
  const required = new Set<string>();
  const visit = (id: string): void => {
    if (!AI_NEW_CATEGORY_ID_PATTERN.test(id) || required.has(id)) return;
    required.add(id);
    const proposal = byId.get(id);
    if (proposal?.parentId) visit(proposal.parentId);
  };
  for (const item of items) {
    if (item.categoryId) visit(item.categoryId);
  }
  return proposals.filter((proposal) => required.has(proposal.id));
}

function asMaterializedProposal(category: ProductCategoryRecord): AiCategoryProposal {
  return {
    id: category.id,
    name: category.name,
    ...(category.parentId ? { parentId: category.parentId } : {}),
    color: category.color ?? UNKNOWN_CATEGORY_COLOR,
    ...(category.description ? { description: category.description } : {}),
  };
}

function appendFallbackWarning(warnings: readonly string[]): readonly string[] {
  return warnings.includes(CATEGORY_FALLBACK_WARNING)
    ? warnings
    : [...warnings, CATEGORY_FALLBACK_WARNING].slice(0, 100);
}

function isSemanticCategoryMaterializationError(error: unknown): boolean {
  if (error instanceof RangeError) return true;
  return error instanceof Error && CATEGORY_SEMANTIC_MATERIALIZATION_ERRORS.has(error.message);
}

function resolveItems(
  items: readonly ReceiptExtractionItem[],
  validIds: ReadonlySet<string>,
  temporaryReferences: ReadonlyMap<string, string>,
  unknownId: string,
): Readonly<{ items: readonly ReceiptExtractionItem[]; usedFallback: boolean }> {
  let usedFallback = false;
  return {
    items: items.map((item) => {
      const requested = item.categoryId;
      const resolved = requested && AI_NEW_CATEGORY_ID_PATTERN.test(requested)
        ? temporaryReferences.get(requested)
        : requested;
      const categoryId = resolved && validIds.has(resolved) ? resolved : unknownId;
      if (categoryId !== resolved) usedFallback = true;
      return { ...item, categoryId };
    }),
    get usedFallback() {
      return usedFallback;
    },
  };
}

export function loadReceiptCategoryInventory(store: CategoryStore): readonly CategoryDescriptor[] {
  store.ensureUnknown();
  return store.list();
}

export function resolveReceiptCategories(
  interpretation: AiReceiptInterpretation,
  store: CategoryStore,
): AiReceiptInterpretation {
  const unknown = store.ensureUnknown();
  const existing = store.list();
  const proposals = referencedProposals(interpretation.items, interpretation.newCategories);

  try {
    const materialized = store.materialize(proposals);
    const validIds = new Set([...existing.map((category) => category.id), ...materialized.created.map((category) => category.id)]);
    validIds.add(unknown.id);
    for (const resolvedId of materialized.references.values()) validIds.add(resolvedId);
    const resolved = resolveItems(interpretation.items, validIds, materialized.references, unknown.id);
    return {
      ...interpretation,
      items: resolved.items,
      newCategories: materialized.created.map(asMaterializedProposal),
      warnings: resolved.usedFallback ? appendFallbackWarning(interpretation.warnings) : interpretation.warnings,
    };
  } catch (error) {
    if (!isSemanticCategoryMaterializationError(error)) throw error;
    const validIds = new Set(existing.map((category) => category.id));
    validIds.add(unknown.id);
    const resolved = resolveItems(interpretation.items, validIds, new Map(), unknown.id);
    return {
      ...interpretation,
      items: resolved.items,
      newCategories: [],
      warnings: appendFallbackWarning(interpretation.warnings),
    };
  }
}
