export const UNKNOWN_CATEGORY_ID = 'category_unknown';
export const UNKNOWN_CATEGORY_NAME = 'desconocido';
export const UNKNOWN_CATEGORY_COLOR = '#64748B';
export const CATEGORY_COLOR_PATTERN = /^#[0-9A-F]{6}$/u;
export const AI_CATEGORY_REFERENCE_PATTERN = /^(?:category_[A-Za-z0-9]+|new:[a-z0-9][a-z0-9_-]{0,79})$/u;
export const AI_NEW_CATEGORY_ID_PATTERN = /^new:[a-z0-9][a-z0-9_-]{0,79}$/u;

export type CategoryDescriptor = Readonly<{
  id: string;
  name: string;
  parentId?: string;
  color?: string;
  description?: string;
}>;

export type AiCategoryProposal = Readonly<{
  id: string;
  name: string;
  parentId?: string;
  color: string;
  description?: string;
}>;

export function normalizeCategoryName(value: string): string {
  const normalized = value.replace(/\s+/gu, ' ').trim();
  if (!normalized || normalized.length > 120) throw new RangeError('Category name must contain between 1 and 120 characters');
  return normalized;
}

export function normalizeCategoryColor(value: string): string {
  const normalized = value.trim().toUpperCase();
  if (!CATEGORY_COLOR_PATTERN.test(normalized)) throw new RangeError('Category color must use #RRGGBB');
  return normalized;
}

export function normalizeOptionalCategoryColor(value?: string | null): string | undefined {
  return value === undefined || value === null || value.trim() === ''
    ? undefined
    : normalizeCategoryColor(value);
}

export function assertCategoryParentReference(id: string, parentId?: string | null): string | undefined {
  if (parentId === undefined || parentId === null || parentId.trim() === '') return undefined;
  const normalized = parentId.trim();
  if (normalized === id) throw new RangeError('Category cannot be its own parent');
  if (normalized.length > 128) throw new RangeError('Category parent id is too long');
  return normalized;
}

export function fallbackCategory(): CategoryDescriptor {
  return {
    id: UNKNOWN_CATEGORY_ID,
    name: UNKNOWN_CATEGORY_NAME,
    color: UNKNOWN_CATEGORY_COLOR,
  };
}

export function compactCategoryInventory(categories: readonly CategoryDescriptor[]): string {
  return JSON.stringify(categories.map((category) => ({
    id: category.id,
    name: category.name,
    parentId: category.parentId ?? null,
    color: category.color ?? null,
  })));
}
