import type { OcrResult } from '../ocr/provider.ts';
import {
  buildReceiptReview,
  mergeReceiptPageItems,
  type AiReceiptInterpretation,
  type AiUnassignedReceiptDiscount,
  type ReceiptExtractionItem,
  type ReceiptMetadata,
} from './extraction.ts';
import { normalizeReceiptItems } from './normalization.ts';

export type ReceiptPageEvidence = Readonly<{
  position: number;
  storageKey: string;
  mimeType: string;
  text: string;
  confidence: number;
  source: OcrResult['source'];
  deterministic: Readonly<{
    items: readonly ReceiptExtractionItem[];
    metadata: ReceiptMetadata;
  }>;
  ai?: Readonly<{
    interpretation: AiReceiptInterpretation;
    attempts: number;
  }>;
}>;

export type ReceiptExtractionResult = Readonly<{
  pages: readonly ReceiptPageEvidence[];
  originalText: string;
  deterministic: Readonly<{
    items: readonly ReceiptExtractionItem[];
    retailerName?: string;
    declaredTotalMinor?: number;
    articleCount?: number;
  }>;
  ai?: Readonly<{
    interpretation: AiReceiptInterpretation;
    attempts: number;
    pages: readonly Readonly<{
      position: number;
      interpretation: AiReceiptInterpretation;
      attempts: number;
    }>[];
  }>;
  final: Readonly<{
    items: readonly ReceiptExtractionItem[];
    retailerName?: string;
    declaredTotalMinor?: number;
    articleCount?: number;
    warnings: readonly string[];
    unassignedDiscounts?: readonly AiUnassignedReceiptDiscount[];
    review: ReturnType<typeof buildReceiptReview>;
  }>;
}>;

export function assembleReceiptExtraction(pages: readonly ReceiptPageEvidence[]): ReceiptExtractionResult {
  const originalText = pages.map((page) => page.text).join('\n').trim();
  const deterministicItems = mergeReceiptPageItems(
    pages.map((page) => page.deterministic.items),
  );
  const deterministicMetadata = combineMetadata(
    pages.map((page) => page.deterministic.metadata),
  );
  const deterministic = {
    items: deterministicItems,
    ...(deterministicMetadata.retailerName
      ? { retailerName: deterministicMetadata.retailerName }
      : {}),
    ...(deterministicMetadata.declaredTotalMinor === undefined
      ? {}
      : { declaredTotalMinor: deterministicMetadata.declaredTotalMinor }),
    ...(deterministicMetadata.articleCount === undefined
      ? {}
      : { articleCount: deterministicMetadata.articleCount }),
  };

  const aiPages = pages.flatMap((page) => page.ai
    ? [{ position: page.position, ...page.ai }]
    : []);
  const aiInterpretations = aiPages.map((page) => page.interpretation);
  const aiMetadata = combineMetadata(aiInterpretations);
  const aiItemsByPage = pages.map((page) => page.ai?.interpretation.items ?? page.deterministic.items);
  const aiItems = mergeReceiptPageItems(aiItemsByPage);
  const warnings = aiInterpretations.flatMap((interpretation) => interpretation.warnings);
  const newCategories = uniqueNewCategories(aiInterpretations.flatMap((interpretation) => interpretation.newCategories ?? []));
  const unassignedDiscounts = aiInterpretations.flatMap((interpretation) => interpretation.unassignedDiscounts ?? []);

  let ai: ReceiptExtractionResult['ai'];
  if (aiPages.length > 0) {
    ai = {
      interpretation: {
        ...(aiMetadata.retailerName ? { retailerName: aiMetadata.retailerName } : {}),
        ...(aiMetadata.declaredTotalMinor === undefined
          ? {}
          : { declaredTotalMinor: aiMetadata.declaredTotalMinor }),
        ...(aiMetadata.articleCount === undefined
          ? {}
          : { articleCount: aiMetadata.articleCount }),
        currency: 'EUR',
        correctedText: aiInterpretations.map((interpretation) => interpretation.correctedText).join('\n').trim(),
        items: aiItems,
        newCategories,
        warnings,
        ...(unassignedDiscounts.length === 0 ? {} : { unassignedDiscounts }),
      },
      attempts: aiPages.reduce((sum, page) => sum + page.attempts, 0),
      pages: aiPages,
    };
  }

  const finalSourceItems = ai?.interpretation.items.length ? ai.interpretation.items : deterministicItems;
  const finalRetailerName = ai?.interpretation.retailerName ?? deterministicMetadata.retailerName;
  const finalTotal = ai?.interpretation.declaredTotalMinor ?? deterministicMetadata.declaredTotalMinor;
  const finalArticleCount = ai?.interpretation.articleCount ?? deterministicMetadata.articleCount;
  const normalized = normalizeReceiptItems({
    items: finalSourceItems,
    warnings,
    unassignedDiscounts,
    ...(finalTotal === undefined ? {} : { declaredTotalMinor: finalTotal }),
  });

  return {
    pages,
    originalText,
    deterministic,
    ...(ai ? { ai } : {}),
    final: {
      items: normalized.items,
      ...(finalRetailerName ? { retailerName: finalRetailerName } : {}),
      ...(finalTotal === undefined ? {} : { declaredTotalMinor: finalTotal }),
      ...(finalArticleCount === undefined ? {} : { articleCount: finalArticleCount }),
      warnings: normalized.warnings,
      ...(normalized.unassignedDiscounts.length === 0 ? {} : { unassignedDiscounts: normalized.unassignedDiscounts }),
      review: buildReceiptReview(normalized.items, finalTotal),
    },
  };
}

function uniqueNewCategories(categories: AiReceiptInterpretation['newCategories']): AiReceiptInterpretation['newCategories'] {
  const seen = new Set<string>();
  return categories.filter((category) => {
    if (seen.has(category.id)) return false;
    seen.add(category.id);
    return true;
  });
}

function combineMetadata(values: readonly ReceiptMetadata[]): ReceiptMetadata {
  const retailerName = values.find((value) => value.retailerName)?.retailerName;
  const declaredTotalMinor = values.findLast((value) => value.declaredTotalMinor !== undefined)?.declaredTotalMinor;
  const articleCount = values.findLast((value) => value.articleCount !== undefined)?.articleCount;
  return {
    ...(retailerName ? { retailerName } : {}),
    ...(declaredTotalMinor === undefined ? {} : { declaredTotalMinor }),
    ...(articleCount === undefined ? {} : { articleCount }),
  };
}
