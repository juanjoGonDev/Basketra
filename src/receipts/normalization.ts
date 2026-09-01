import {
  calculateReceiptLineDiscountMinor,
  calculateReceiptLineTotal,
  type ReceiptLineDiscount,
} from '../domain/receipt.ts';
import type { AiUnassignedReceiptDiscount, ReceiptExtractionItem } from './extraction.ts';

const MAX_NORMALIZED_SOURCE_LINES = 20;

type NormalizationInput = Readonly<{
  items: readonly ReceiptExtractionItem[];
  warnings: readonly string[];
  unassignedDiscounts?: readonly AiUnassignedReceiptDiscount[];
  declaredTotalMinor?: number;
}>;

export type NormalizedReceiptItems = Readonly<{
  items: readonly ReceiptExtractionItem[];
  warnings: readonly string[];
  unassignedDiscounts: readonly AiUnassignedReceiptDiscount[];
}>;

function normalizeDescription(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, ' ')
    .trim();
}

function safeAdd(left: number, right: number, label: string): number {
  const total = left + right;
  if (!Number.isSafeInteger(total) || total < 0) throw new RangeError(`${label} exceeds the safe integer range`);
  return total;
}

function mergeSourceLines(...groups: readonly (readonly number[] | undefined)[]): readonly number[] {
  const seen = new Set<number>();
  const merged: number[] = [];
  for (const group of groups) {
    for (const sourceLine of group ?? []) {
      if (seen.has(sourceLine)) continue;
      seen.add(sourceLine);
      merged.push(sourceLine);
      if (merged.length === MAX_NORMALIZED_SOURCE_LINES) return merged;
    }
  }
  return merged;
}

function groupKey(item: ReceiptExtractionItem): string | undefined {
  if (item.discount !== undefined || item.discountMinor !== undefined) return undefined;
  return [
    normalizeDescription(item.description),
    String(item.quantity),
    String(item.unitPriceMinor),
    String(item.lineTotalMinor),
    item.taxCategory ?? '',
  ].join('|');
}

export function groupEquivalentReceiptItems(items: readonly ReceiptExtractionItem[]): ReceiptExtractionItem[] {
  const grouped: ReceiptExtractionItem[] = [];
  const indexByKey = new Map<string, number>();

  for (const item of items) {
    const key = groupKey(item);
    const previousIndex = key === undefined ? undefined : indexByKey.get(key);
    if (key === undefined || previousIndex === undefined) {
      if (key !== undefined) indexByKey.set(key, grouped.length);
      grouped.push({ ...item });
      continue;
    }

    const previous = grouped[previousIndex];
    if (!previous) throw new Error('Receipt grouping index is invalid');
    grouped[previousIndex] = {
      ...previous,
      quantity: safeAdd(previous.quantity, item.quantity, 'Receipt grouped quantity'),
      lineTotalMinor: safeAdd(previous.lineTotalMinor, item.lineTotalMinor, 'Receipt grouped total'),
      confidence: Math.min(previous.confidence, item.confidence),
      sourceLines: mergeSourceLines(previous.sourceLines, item.sourceLines),
    };
  }

  return grouped;
}

function totalMinor(items: readonly ReceiptExtractionItem[]): number {
  return items.reduce((sum, item) => safeAdd(sum, item.lineTotalMinor, 'Receipt total'), 0);
}

function discountWithQuantity(discount: ReceiptLineDiscount, quantity: number): ReceiptLineDiscount {
  return discount.type === 'amount'
    ? { type: 'amount', amountMinor: discount.amountMinor, quantity }
    : { type: 'percentage', basisPoints: discount.basisPoints, quantity };
}

function inferPercentageQuantity(
  item: ReceiptExtractionItem,
  discount: Extract<ReceiptLineDiscount, { type: 'percentage' }>,
  targetDiscountMinor: number,
): number | undefined {
  const matches: number[] = [];
  for (let quantity = 1; quantity <= item.quantity; quantity += 1) {
    const discountMinor = calculateReceiptLineDiscountMinor({
      quantity: item.quantity,
      unitPriceMinor: item.unitPriceMinor,
      discount: { ...discount, quantity },
    });
    if (discountMinor === targetDiscountMinor) matches.push(quantity);
  }
  return matches.length === 1 ? matches[0] : undefined;
}

function isUndiscountedSubtotal(item: ReceiptExtractionItem): boolean {
  return item.discount === undefined
    && item.discountMinor === undefined
    && item.lineTotalMinor === item.quantity * item.unitPriceMinor;
}

function duplicateAmbiguityReason(reason: string): boolean {
  const normalized = normalizeDescription(reason);
  return /\b(?:duplicate|duplicated|identical|twice|two|duplicad\w*|identic\w*|dos)\b/u.test(normalized);
}

function warningMatchesResolvedDuplicate(warning: string, entry: AiUnassignedReceiptDiscount): boolean {
  if (!entry.description || !duplicateAmbiguityReason(entry.reason)) return false;
  const description = normalizeDescription(entry.description);
  const normalizedWarning = normalizeDescription(warning);
  if (!description || !normalizedWarning.includes(description)) return false;
  return /\b(?:discount|descuento|dto)\b/u.test(normalizedWarning);
}

export function normalizeReceiptItems(input: NormalizationInput): NormalizedReceiptItems {
  const items = groupEquivalentReceiptItems(input.items);
  const pending = [...(input.unassignedDiscounts ?? [])];
  const resolvedDuplicateEntries: AiUnassignedReceiptDiscount[] = [];

  for (let pendingIndex = 0; pendingIndex < pending.length;) {
    const entry = pending[pendingIndex];
    if (!entry?.description) {
      pendingIndex += 1;
      continue;
    }
    const description = normalizeDescription(entry.description);
    const candidates = items
      .map((item, index) => ({ item, index }))
      .filter(({ item }) => normalizeDescription(item.description) === description && isUndiscountedSubtotal(item));
    if (candidates.length !== 1) {
      pendingIndex += 1;
      continue;
    }

    const candidate = candidates[0];
    if (!candidate) {
      pendingIndex += 1;
      continue;
    }

    let discount = entry.discount;
    if (discount.quantity === undefined && candidate.item.quantity === 1) {
      discount = discountWithQuantity(discount, 1);
    } else if (
      discount.quantity === undefined
      && discount.type === 'percentage'
      && pending.length === 1
      && input.declaredTotalMinor !== undefined
    ) {
      const targetDiscountMinor = totalMinor(items) - input.declaredTotalMinor;
      if (targetDiscountMinor > 0) {
        const quantity = inferPercentageQuantity(candidate.item, discount, targetDiscountMinor);
        if (quantity !== undefined) discount = discountWithQuantity(discount, quantity);
      }
    }

    if (discount.type === 'percentage' && discount.quantity === undefined) {
      pendingIndex += 1;
      continue;
    }

    let lineTotalMinor: number;
    try {
      lineTotalMinor = calculateReceiptLineTotal({
        quantity: candidate.item.quantity,
        unitPriceMinor: candidate.item.unitPriceMinor,
        discount,
      });
    } catch {
      pendingIndex += 1;
      continue;
    }

    items[candidate.index] = {
      ...candidate.item,
      discount,
      lineTotalMinor,
      sourceLines: mergeSourceLines(candidate.item.sourceLines, entry.sourceLines),
    };
    resolvedDuplicateEntries.push(entry);
    pending.splice(pendingIndex, 1);
  }

  const warnings = input.warnings.filter((warning) => (
    !resolvedDuplicateEntries.some((entry) => warningMatchesResolvedDuplicate(warning, entry))
  ));

  return { items, warnings, unassignedDiscounts: pending };
}
