import {
  buildAiAttachmentContentPart,
  type AiAttachmentInput,
  type AiProvider,
} from '../ai/provider.ts';
import { StructuredAiExecutor, type RuntimeSchema } from '../ai/structured-executor.ts';
import { validateReceiptLine, validateReceiptTotal, type ReceiptLineInput } from '../domain/receipt.ts';
import { asArray, asEnum, asRecord, asSafeInteger, asString } from '../domain/validation.ts';

const CURRENCIES = ['EUR'] as const;
const TAX_CATEGORIES = ['A', 'B', 'C'] as const;
const REVIEW_CONFIDENCE_THRESHOLD = 0.75;
const MAX_SOURCE_LINES = 20;
export const RECEIPT_PAGE_VERIFICATION_SCHEMA_NAME = 'receipt_page_verification';

type ReceiptTaxCategory = typeof TAX_CATEGORIES[number];

export type ReceiptExtractionItem = ReceiptLineInput & Readonly<{
  confidence: number;
  taxCategory?: ReceiptTaxCategory;
  sourceLines?: readonly number[];
}>;

export type ReceiptMetadata = Readonly<{
  retailerName?: string;
  declaredTotalMinor?: number;
  articleCount?: number;
}>;

export type AiReceiptInterpretation = Readonly<{
  retailerName?: string;
  purchasedAt?: string;
  declaredTotalMinor?: number;
  articleCount?: number;
  currency: 'EUR';
  correctedText: string;
  items: readonly ReceiptExtractionItem[];
  warnings: readonly string[];
}>;

export type ReceiptAiSession = Readonly<{
  affinity: string;
  final: boolean;
  pageCount: number;
  pagePosition: number;
}>;

export type ReceiptReviewLine = ReceiptExtractionItem & Readonly<{
  status: 'confirmed' | 'needs-review' | 'unreadable' | 'arithmetic-mismatch';
  expectedMinor: number;
  differenceMinor: number;
}>;

export type ReceiptReview = Readonly<{
  lines: readonly ReceiptReviewLine[];
  total?: Readonly<{ expectedMinor: number; differenceMinor: number; valid: boolean }>;
}>;

export const RECEIPT_SCHEMA: RuntimeSchema<AiReceiptInterpretation> = {
  jsonSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['currency', 'correctedText', 'items', 'warnings'],
    properties: {
      retailerName: { type: 'string', minLength: 1, maxLength: 160 },
      purchasedAt: { type: 'string', minLength: 10, maxLength: 40 },
      declaredTotalMinor: { type: 'integer', minimum: 0 },
      articleCount: { type: 'integer', minimum: 0, maximum: 100_000 },
      currency: { type: 'string', enum: CURRENCIES },
      correctedText: { type: 'string', minLength: 1, maxLength: 500_000 },
      items: {
        type: 'array',
        maxItems: 500,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['description', 'quantity', 'unitPriceMinor', 'lineTotalMinor', 'confidence', 'sourceLines'],
          properties: {
            description: { type: 'string', maxLength: 240 },
            quantity: { type: 'integer', minimum: 0, maximum: 100_000 },
            unitPriceMinor: { type: 'integer', minimum: 0 },
            lineTotalMinor: { type: 'integer', minimum: 0 },
            discountMinor: { type: 'integer', minimum: 0 },
            taxCategory: { type: 'string', enum: TAX_CATEGORIES },
            confidence: { type: 'number', minimum: 0, maximum: 1 },
            sourceLines: {
              type: 'array',
              minItems: 1,
              maxItems: MAX_SOURCE_LINES,
              items: { type: 'integer', minimum: 1, maximum: 100_000 },
            },
          },
        },
      },
      warnings: { type: 'array', maxItems: 100, items: { type: 'string', maxLength: 240 } },
    },
  },
  parse(value: unknown) {
    const root = asRecord(value);
    const retailerName = typeof root['retailerName'] === 'string'
      ? asString(root['retailerName'], '$.retailerName', { min: 1, max: 160 })
      : undefined;
    const purchasedAt = typeof root['purchasedAt'] === 'string'
      ? asString(root['purchasedAt'], '$.purchasedAt', { min: 10, max: 40 })
      : undefined;
    const declaredTotalMinor = root['declaredTotalMinor'] === undefined
      ? undefined
      : asSafeInteger(root['declaredTotalMinor'], '$.declaredTotalMinor', { min: 0 });
    const articleCount = root['articleCount'] === undefined
      ? undefined
      : asSafeInteger(root['articleCount'], '$.articleCount', { min: 0, max: 100_000 });
    const items = asArray(root['items'], '$.items', 500).map((entry, index): ReceiptExtractionItem => {
      const item = asRecord(entry, `$.items[${index}]`);
      const confidence = Number(item['confidence']);
      if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
        throw new RangeError(`$.items[${index}].confidence must be between 0 and 1`);
      }
      const sourceLines = asArray(item['sourceLines'], `$.items[${index}].sourceLines`, MAX_SOURCE_LINES)
        .map((line, lineIndex) => asSafeInteger(line, `$.items[${index}].sourceLines[${lineIndex}]`, { min: 1, max: 100_000 }));
      if (sourceLines.length === 0) {
        throw new RangeError(`$.items[${index}].sourceLines must contain at least one OCR line`);
      }
      const taxCategory = item['taxCategory'] === undefined
        ? undefined
        : asEnum(item['taxCategory'], `$.items[${index}].taxCategory`, TAX_CATEGORIES);
      return {
        description: asString(item['description'], `$.items[${index}].description`, { max: 240 }),
        quantity: asSafeInteger(item['quantity'], `$.items[${index}].quantity`, { min: 0, max: 100_000 }),
        unitPriceMinor: asSafeInteger(item['unitPriceMinor'], `$.items[${index}].unitPriceMinor`, { min: 0 }),
        lineTotalMinor: asSafeInteger(item['lineTotalMinor'], `$.items[${index}].lineTotalMinor`, { min: 0 }),
        ...(item['discountMinor'] === undefined
          ? {}
          : { discountMinor: asSafeInteger(item['discountMinor'], `$.items[${index}].discountMinor`, { min: 0 }) }),
        ...(taxCategory ? { taxCategory } : {}),
        confidence,
        sourceLines,
      };
    });
    const warnings = asArray(root['warnings'], '$.warnings', 100)
      .map((warning, index) => asString(warning, `$.warnings[${index}]`, { max: 240 }));
    return {
      ...(retailerName ? { retailerName } : {}),
      ...(purchasedAt ? { purchasedAt } : {}),
      ...(declaredTotalMinor === undefined ? {} : { declaredTotalMinor }),
      ...(articleCount === undefined ? {} : { articleCount }),
      currency: asEnum(root['currency'], '$.currency', CURRENCIES),
      correctedText: asString(root['correctedText'], '$.correctedText', { min: 1, max: 500_000 }),
      items,
      warnings,
    };
  },
};

export function buildNumberedReceiptText(originalText: string): string {
  return originalText
    .split(/\r?\n/u)
    .map((line, index) => `${index + 1}: ${line}`)
    .join('\n');
}

export function buildReceiptVerificationInstructions(
  page?: Readonly<{ pageCount: number; pagePosition: number }>,
): string {
  return [
    'Verify one grocery-receipt page using both the original attached capture and its OCR transcription.',
    'Treat the attachment as the visual or document source of truth and the numbered OCR as editable evidence for source-line references.',
    'Do not invent unreadable products, quantities, prices, totals or retailer names.',
    'Preserve physical line order and reconstruct a quantity prefix only when the immediately following product line supports it.',
    'For example, `6 x ,89` followed by `C.LADRON MANZAN 5,34 A` means quantity 6, unit price 89 cents, line total 534 cents and tax category A.',
    'Separate trailing tax letters A, B or C from monetary values.',
    'Return monetary fields as integer euro cents.',
    'Return sourceLines with the numbered OCR lines supporting every item, even when the attachment corrects OCR characters.',
    'Return correctedText in page order, retailerName, declaredTotalMinor and articleCount only when visible in the attachment or OCR.',
    'Keep each warning within 240 characters.',
    'Mark uncertainty through confidence and warnings. Return JSON only.',
    ...(page
      ? [`This is page ${String(page.pagePosition + 1)} of ${String(page.pageCount)} of one receipt. Return only this page; do not repeat or modify prior pages.`]
      : []),
  ].join(' ');
}

export function parseDeterministicReceiptText(text: string): ReceiptExtractionItem[] {
  const items: ReceiptExtractionItem[] = [];
  let pendingQuantity: Readonly<{ quantity: number; unitPriceMinor: number; sourceLine: number }> | undefined;
  const lines = text.split(/\r?\n/u);

  for (const [index, rawLine] of lines.entries()) {
    const line = rawLine.trim();
    if (!line) continue;
    const sourceLine = index + 1;

    const quantityPrefix = /^(\d+)\s*[xX]\s*([.,]\d{2}|\d[\d.,]*[.,]\d{2})$/u.exec(line);
    if (quantityPrefix?.[1] && quantityPrefix[2]) {
      pendingQuantity = {
        quantity: parseSafeInteger(quantityPrefix[1]),
        unitPriceMinor: parsePriceMinor(quantityPrefix[2]),
        sourceLine,
      };
      continue;
    }

    const delimited = parseDelimitedReceiptLine(line, sourceLine);
    if (delimited) {
      items.push(delimited);
      pendingQuantity = undefined;
      continue;
    }

    const inlineMultiplied = /^(.*?)\s+(\d+)\s*[xX]\s*([.,]\d{2}|\d[\d.,]*[.,]\d{2})\s+([.,]\d{2}|\d[\d.,]*[.,]\d{2})(?:\s*[- ]?\s*([ABC]))?$/iu.exec(line);
    if (inlineMultiplied?.[1] && inlineMultiplied[2] && inlineMultiplied[3] && inlineMultiplied[4]) {
      const taxCategory = inlineMultiplied[5]?.toUpperCase() as ReceiptTaxCategory | undefined;
      items.push({
        description: inlineMultiplied[1].trim(),
        quantity: parseSafeInteger(inlineMultiplied[2]),
        unitPriceMinor: parsePriceMinor(inlineMultiplied[3]),
        lineTotalMinor: parsePriceMinor(inlineMultiplied[4]),
        ...(taxCategory ? { taxCategory } : {}),
        confidence: 0.95,
        sourceLines: [sourceLine],
      });
      pendingQuantity = undefined;
      continue;
    }

    const priced = /^(.*?)\s+([.,]\d{2}|\d[\d.,]*[.,]\d{2})(?:\s*[- ]?\s*([ABC]))?$/iu.exec(line);
    if (priced?.[1] && priced[2] && !isReceiptSummaryLabel(priced[1])) {
      const lineTotalMinor = parsePriceMinor(priced[2]);
      const taxCategory = priced[3]?.toUpperCase() as ReceiptTaxCategory | undefined;
      items.push({
        description: priced[1].trim(),
        quantity: pendingQuantity?.quantity ?? 1,
        unitPriceMinor: pendingQuantity?.unitPriceMinor ?? lineTotalMinor,
        lineTotalMinor,
        ...(taxCategory ? { taxCategory } : {}),
        confidence: pendingQuantity ? 0.92 : 0.7,
        sourceLines: pendingQuantity ? [pendingQuantity.sourceLine, sourceLine] : [sourceLine],
      });
      pendingQuantity = undefined;
      continue;
    }

    pendingQuantity = undefined;
  }

  return items;
}

export function extractDeclaredTotalMinor(text: string): number | undefined {
  for (const rawLine of text.split(/\r?\n/u).reverse()) {
    const match = /^\s*(?:tot(?:al)?|importe|a pagar)\b.*?([.,]\d{2}|\d[\d.,]*[.,]\d{2})\s*(?:€|eur)?\s*$/iu.exec(rawLine);
    if (match?.[1]) return parsePriceMinor(match[1]);
  }
  return undefined;
}

export function extractReceiptMetadata(text: string): ReceiptMetadata {
  const lines = text.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean);
  const declaredTotalMinor = extractDeclaredTotalMinor(text);
  let articleCount: number | undefined;
  for (const line of lines.slice().reverse()) {
    const match = /(?:num\.?\s*)?total\s+art(?:\.|ículos?)?(?:\s+vendidos)?\s*(?:=|:)?\s*(\d+)/iu.exec(line);
    if (match?.[1]) {
      articleCount = parseSafeInteger(match[1]);
      break;
    }
  }

  const retailerName = lines.slice(0, 12).find((line) => {
    if (line.length < 3 || line.length > 160) return false;
    if (/\d[\d.,]*[.,]\d{2}/u.test(line)) return false;
    if (/^(?:factura|ticket|fecha|cif|nif|direccion|dirección|tel|caja|cajero|iva|total)\b/iu.test(line)) return false;
    return /[A-ZÁÉÍÓÚÜÑ]{3}/u.test(line);
  });

  return {
    ...(retailerName ? { retailerName: normalizeRetailerName(retailerName) } : {}),
    ...(declaredTotalMinor === undefined ? {} : { declaredTotalMinor }),
    ...(articleCount === undefined ? {} : { articleCount }),
  };
}

export function mergeReceiptPageItems(pages: readonly (readonly ReceiptExtractionItem[])[]): ReceiptExtractionItem[] {
  const merged: ReceiptExtractionItem[] = [];
  for (const page of pages) {
    const overlap = findAdjacentOverlap(merged, page);
    merged.push(...page.slice(overlap));
  }
  return merged;
}

export function buildReceiptReview(items: readonly ReceiptExtractionItem[], declaredTotalMinor?: number): ReceiptReview {
  const lines = items.map((item): ReceiptReviewLine => {
    const validation = validateReceiptLine(item);
    return {
      ...item,
      status: validation.status === 'confirmed' && item.confidence < REVIEW_CONFIDENCE_THRESHOLD
        ? 'needs-review'
        : validation.status,
      expectedMinor: validation.expectedMinor,
      differenceMinor: validation.differenceMinor,
    };
  });
  return {
    lines,
    ...(declaredTotalMinor === undefined ? {} : { total: validateReceiptTotal(items, declaredTotalMinor) }),
  };
}

export async function verifyReceiptWithAi(
  provider: AiProvider,
  maxRetries: number,
  originalText: string,
  attachment: AiAttachmentInput,
  signal?: AbortSignal,
  session?: ReceiptAiSession,
): Promise<Readonly<{ value: AiReceiptInterpretation; attempts: number }>> {
  const executor = new StructuredAiExecutor(provider, maxRetries);
  const attachmentPart = buildAiAttachmentContentPart(attachment, await provider.getCapabilities());
  const result = await executor.execute({
    operation: 'receipt-page-verification',
    schemaName: RECEIPT_PAGE_VERIFICATION_SCHEMA_NAME,
    systemPrompt: buildReceiptVerificationInstructions(session),
    content: [
      {
        type: 'text',
        text: [
          'Numbered OCR transcription for this same attachment:',
          buildNumberedReceiptText(originalText),
        ].join('\n'),
      },
      attachmentPart,
    ],
    schema: RECEIPT_SCHEMA,
    ...(session ? { sessionAffinity: session.affinity, sessionFinal: session.final } : {}),
    ...(signal ? { signal } : {}),
  });
  return result;
}

function parseDelimitedReceiptLine(line: string, sourceLine: number): ReceiptExtractionItem | undefined {
  const parts = line.split(/[;|]/u).map((part) => part.trim());
  if (parts.length < 4 || parts.length > 6 || !parts[0] || !parts[1] || !parts[2] || !parts[3]) return undefined;
  if (!/^\d+$/u.test(parts[1]) || !/^\d+$/u.test(parts[2]) || !/^\d+$/u.test(parts[3])) return undefined;

  let taxCategory: ReceiptTaxCategory | undefined;
  let discountMinor: number | undefined;
  for (const optional of parts.slice(4)) {
    if (!optional) continue;
    const normalized = optional.toUpperCase();
    if ((TAX_CATEGORIES as readonly string[]).includes(normalized)) {
      taxCategory = normalized as ReceiptTaxCategory;
      continue;
    }
    if (/^\d+$/u.test(optional)) discountMinor = parseSafeInteger(optional);
  }

  return {
    description: parts[0],
    quantity: parseSafeInteger(parts[1]),
    unitPriceMinor: parseSafeInteger(parts[2]),
    lineTotalMinor: parseSafeInteger(parts[3]),
    ...(discountMinor === undefined ? {} : { discountMinor }),
    ...(taxCategory ? { taxCategory } : {}),
    confidence: 1,
    sourceLines: [sourceLine],
  };
}

function findAdjacentOverlap(
  accumulated: readonly ReceiptExtractionItem[],
  nextPage: readonly ReceiptExtractionItem[],
): number {
  const maximum = Math.min(20, accumulated.length, nextPage.length);
  for (let size = maximum; size >= 2; size -= 1) {
    const start = accumulated.length - size;
    let matches = true;
    for (let index = 0; index < size; index += 1) {
      const left = accumulated[start + index];
      const right = nextPage[index];
      if (!left || !right || !sameOverlapLine(left, right)) {
        matches = false;
        break;
      }
    }
    if (matches) return size;
  }
  return 0;
}

function sameOverlapLine(left: ReceiptExtractionItem, right: ReceiptExtractionItem): boolean {
  if (left.quantity !== right.quantity
    || left.unitPriceMinor !== right.unitPriceMinor
    || left.lineTotalMinor !== right.lineTotalMinor
    || (left.discountMinor ?? 0) !== (right.discountMinor ?? 0)
    || left.taxCategory !== right.taxCategory) {
    return false;
  }
  const leftDescription = normalizeDescription(left.description);
  const rightDescription = normalizeDescription(right.description);
  if (leftDescription === rightDescription) return true;
  const shorter = leftDescription.length <= rightDescription.length ? leftDescription : rightDescription;
  const longer = shorter === leftDescription ? rightDescription : leftDescription;
  return shorter.length >= 8 && longer.includes(shorter) && shorter.length / longer.length >= 0.75;
}

function normalizeDescription(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, ' ')
    .trim();
}

function normalizeRetailerName(value: string): string {
  return value.replace(/\s+/gu, ' ').trim();
}

function parseSafeInteger(value: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new RangeError('Receipt value is not a non-negative safe integer');
  return parsed;
}

function parsePriceMinor(value: string): number {
  const compact = value.replace(/\s/gu, '');
  const normalized = compact.startsWith(',') || compact.startsWith('.') ? `0${compact}` : compact;
  const separator = Math.max(normalized.lastIndexOf(','), normalized.lastIndexOf('.'));
  if (separator <= 0 || normalized.length - separator !== 3) throw new RangeError('Receipt price must have two decimal places');
  const whole = normalized.slice(0, separator).replace(/[.,]/gu, '');
  const fraction = normalized.slice(separator + 1);
  if (!/^\d+$/u.test(whole) || !/^\d{2}$/u.test(fraction)) throw new RangeError('Receipt price is malformed');
  return parseSafeInteger(`${whole}${fraction}`);
}

function isReceiptSummaryLabel(label: string): boolean {
  return /^(?:sub\s*total|tot(?:al)?|importe|a pagar|efectivo|tarjeta|cambio|iva|base imponible|num\.?\s*total\s+art)\b/iu.test(label.trim());
}
