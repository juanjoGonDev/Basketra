import {
  buildAiAttachmentContentPart,
  type AiAttachmentInput,
  type AiProvider,
} from '../ai/provider.ts';
import { StructuredAiExecutor, type RuntimeSchema } from '../ai/structured-executor.ts';
import {
  AI_CATEGORY_REFERENCE_PATTERN,
  AI_NEW_CATEGORY_ID_PATTERN,
  UNKNOWN_CATEGORY_ID,
  compactCategoryInventory,
  normalizeCategoryColor,
  normalizeCategoryName,
  type AiCategoryProposal,
  type CategoryDescriptor,
} from '../domain/categories.ts';
import {
  parseReceiptLineDiscount,
  validateReceiptLine,
  validateReceiptTotal,
  type ReceiptLineDiscount,
  type ReceiptLineInput,
} from '../domain/receipt.ts';
import { asArray, asEnum, asRecord, asSafeInteger, asString } from '../domain/validation.ts';

const CURRENCIES = ['EUR'] as const;
const TAX_CATEGORIES = ['A', 'B', 'C'] as const;
const REVIEW_CONFIDENCE_THRESHOLD = 0.75;
const MAX_SOURCE_LINES = 20;
const MAX_AI_NEW_CATEGORIES = 50;
export const RECEIPT_PAGE_VERIFICATION_SCHEMA_NAME = 'receipt_page_verification';

type ReceiptTaxCategory = typeof TAX_CATEGORIES[number];

export type ReceiptExtractionItem = ReceiptLineInput & Readonly<{
  confidence: number;
  categoryId?: string;
  taxCategory?: ReceiptTaxCategory;
  sourceLines?: readonly number[];
}>;

export type ReceiptMetadata = Readonly<{
  retailerName?: string;
  declaredTotalMinor?: number;
  articleCount?: number;
}>;

export type AiUnassignedReceiptDiscount = Readonly<{
  discount: ReceiptLineDiscount;
  sourceLines: readonly number[];
  description?: string;
  reason: string;
}>;

export type AiReceiptInterpretation = Readonly<{
  retailerName?: string;
  purchasedAt?: string;
  declaredTotalMinor?: number;
  articleCount?: number;
  currency: 'EUR';
  correctedText: string;
  items: readonly ReceiptExtractionItem[];
  newCategories: readonly AiCategoryProposal[];
  warnings: readonly string[];
  unassignedDiscounts?: readonly AiUnassignedReceiptDiscount[];
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

const DISCOUNT_SCHEMA = {
  oneOf: [
    {
      type: 'object',
      additionalProperties: false,
      required: ['type', 'amountMinor'],
      properties: {
        type: { type: 'string', enum: ['amount'] },
        amountMinor: { type: 'integer', minimum: 0 },
        quantity: { type: 'integer', minimum: 1, maximum: 100_000 },
      },
    },
    {
      type: 'object',
      additionalProperties: false,
      required: ['type', 'basisPoints'],
      properties: {
        type: { type: 'string', enum: ['percentage'] },
        basisPoints: { type: 'integer', minimum: 0, maximum: 10_000 },
        quantity: { type: 'integer', minimum: 1, maximum: 100_000 },
      },
    },
  ],
} as const;

const SOURCE_LINES_SCHEMA = {
  type: 'array',
  minItems: 1,
  maxItems: MAX_SOURCE_LINES,
  items: { type: 'integer', minimum: 1, maximum: 100_000 },
} as const;

const NEW_CATEGORY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'name', 'parentId', 'color'],
  properties: {
    id: { type: 'string', minLength: 5, maxLength: 84, pattern: '^new:[a-z0-9][a-z0-9_-]{0,79}$' },
    name: { type: 'string', minLength: 1, maxLength: 120 },
    parentId: { type: ['string', 'null'], maxLength: 128 },
    color: { type: 'string', pattern: '^#[0-9A-F]{6}$' },
    description: { type: 'string', minLength: 1, maxLength: 500 },
  },
} as const;

export const RECEIPT_SCHEMA: RuntimeSchema<AiReceiptInterpretation> = {
  jsonSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['currency', 'correctedText', 'items', 'newCategories', 'warnings'],
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
          required: ['description', 'quantity', 'unitPriceMinor', 'lineTotalMinor', 'confidence', 'categoryId', 'sourceLines'],
          properties: {
            description: { type: 'string', maxLength: 240 },
            quantity: { type: 'integer', minimum: 0, maximum: 100_000 },
            unitPriceMinor: { type: 'integer', minimum: 0 },
            lineTotalMinor: { type: 'integer', minimum: 0 },
            discount: DISCOUNT_SCHEMA,
            taxCategory: { type: 'string', enum: TAX_CATEGORIES },
            confidence: { type: 'number', minimum: 0, maximum: 1 },
            categoryId: { type: 'string', minLength: 1, maxLength: 128 },
            sourceLines: SOURCE_LINES_SCHEMA,
          },
        },
      },
      newCategories: {
        type: 'array',
        maxItems: MAX_AI_NEW_CATEGORIES,
        items: NEW_CATEGORY_SCHEMA,
      },
      unassignedDiscounts: {
        type: 'array',
        maxItems: 100,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['discount', 'sourceLines', 'reason'],
          properties: {
            discount: DISCOUNT_SCHEMA,
            sourceLines: SOURCE_LINES_SCHEMA,
            description: { type: 'string', minLength: 1, maxLength: 240 },
            reason: { type: 'string', minLength: 1, maxLength: 240 },
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
      const path = `$.items[${index}]`;
      const item = asRecord(entry, path);
      const confidence = Number(item['confidence']);
      if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
        throw new RangeError(`${path}.confidence must be between 0 and 1`);
      }
      const sourceLines = parseSourceLines(item['sourceLines'], `${path}.sourceLines`);
      const taxCategory = item['taxCategory'] === undefined
        ? undefined
        : asEnum(item['taxCategory'], `${path}.taxCategory`, TAX_CATEGORIES);
      const categoryId = item['categoryId'] === undefined
        ? UNKNOWN_CATEGORY_ID
        : parseAiCategoryReference(item['categoryId'], `${path}.categoryId`);
      const parsed: ReceiptExtractionItem = {
        description: asString(item['description'], `${path}.description`, { max: 240 }),
        quantity: asSafeInteger(item['quantity'], `${path}.quantity`, { min: 0, max: 100_000 }),
        unitPriceMinor: asSafeInteger(item['unitPriceMinor'], `${path}.unitPriceMinor`, { min: 0 }),
        lineTotalMinor: asSafeInteger(item['lineTotalMinor'], `${path}.lineTotalMinor`, { min: 0 }),
        ...(item['discount'] === undefined ? {} : { discount: parseReceiptLineDiscount(item['discount'], `${path}.discount`) }),
        categoryId,
        ...(taxCategory ? { taxCategory } : {}),
        confidence,
        sourceLines,
      };
      validateReceiptLine(parsed);
      return parsed;
    });
    const newCategories = root['newCategories'] === undefined
      ? []
      : asArray(root['newCategories'], '$.newCategories', MAX_AI_NEW_CATEGORIES)
        .map((entry, index) => parseAiCategoryProposal(entry, `$.newCategories[${index}]`));
    const unassignedDiscounts = root['unassignedDiscounts'] === undefined
      ? undefined
      : asArray(root['unassignedDiscounts'], '$.unassignedDiscounts', 100).map((entry, index): AiUnassignedReceiptDiscount => {
        const path = `$.unassignedDiscounts[${index}]`;
        const discount = asRecord(entry, path);
        const description = discount['description'] === undefined
          ? undefined
          : asString(discount['description'], `${path}.description`, { min: 1, max: 240 });
        return {
          discount: parseReceiptLineDiscount(discount['discount'], `${path}.discount`),
          sourceLines: parseSourceLines(discount['sourceLines'], `${path}.sourceLines`),
          ...(description ? { description } : {}),
          reason: asString(discount['reason'], `${path}.reason`, { min: 1, max: 240 }),
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
      newCategories,
      ...(unassignedDiscounts ? { unassignedDiscounts } : {}),
      warnings,
    };
  },
};

function parseSourceLines(value: unknown, path: string): readonly number[] {
  const sourceLines = asArray(value, path, MAX_SOURCE_LINES)
    .map((line, index) => asSafeInteger(line, `${path}[${index}]`, { min: 1, max: 100_000 }));
  if (sourceLines.length === 0) throw new RangeError(`${path} must contain at least one OCR line`);
  return sourceLines;
}

function parseAiCategoryReference(value: unknown, path: string): string {
  const id = asString(value, path, { min: 1, max: 128 });
  if (!AI_CATEGORY_REFERENCE_PATTERN.test(id)) throw new RangeError(`${path} is not a valid category reference`);
  return id;
}

function parseAiCategoryProposal(value: unknown, path: string): AiCategoryProposal {
  const proposal = asRecord(value, path);
  const id = asString(proposal['id'], `${path}.id`, { min: 5, max: 84 });
  if (!AI_NEW_CATEGORY_ID_PATTERN.test(id)) throw new RangeError(`${path}.id must use a new:* temporary category id`);
  const parentValue = proposal['parentId'];
  const parentId = parentValue === undefined || parentValue === null || parentValue === ''
    ? undefined
    : parseAiCategoryReference(parentValue, `${path}.parentId`);
  const description = proposal['description'] === undefined
    ? undefined
    : asString(proposal['description'], `${path}.description`, { min: 1, max: 500 });
  return {
    id,
    name: normalizeCategoryName(asString(proposal['name'], `${path}.name`, { min: 1, max: 120 })),
    ...(parentId ? { parentId } : {}),
    color: normalizeCategoryColor(asString(proposal['color'], `${path}.color`, { min: 7, max: 7 })),
    ...(description ? { description } : {}),
  };
}

export function buildNumberedReceiptText(originalText: string): string {
  return originalText
    .split(/\r?\n/u)
    .map((line, index) => `${index + 1}: ${line}`)
    .join('\n');
}

export function buildReceiptCategoryContext(categories: readonly CategoryDescriptor[]): string {
  return [
    'Available product categories (id, name, parentId, color):',
    compactCategoryInventory(categories),
  ].join('\n');
}

export function buildReceiptVerificationInstructions(
  page?: Readonly<{ pageCount: number; pagePosition: number }>,
): string {
  return [
    'Verify one grocery-receipt page using both the original attached capture and its OCR transcription.',
    'Treat the attachment as the visual or document source of truth and the numbered OCR as editable evidence for source-line references.',
    'Do not invent unreadable products, quantities, prices, totals, discounts or retailer names.',
    'Classify every product item using categoryId. Reuse an available category when it is semantically suitable, including nested categories through parentId.',
    'Use the category named desconocido when the product cannot be classified safely from the receipt evidence.',
    'Create a category only when no existing category is semantically suitable. Declare each missing category once in newCategories with a temporary id using new:<token>, name, parentId, color as #RRGGBB and optional description.',
    'A new category parentId may reference either an existing category id or another new:<token> declared in the same response. Do not rename, reparent or duplicate an existing category.',
    'When an item uses a newly proposed category, its categoryId must be that exact new:<token>. Return an empty newCategories array when no category is missing.',
    'Preserve physical line order and reconstruct a quantity prefix only when the immediately following product line supports it.',
    'For example, `6 x ,89` followed by `C.LADRON MANZAN 5,34 A` means quantity 6, unit price 89 cents, line total 534 cents and tax category A.',
    'Separate trailing tax letters A, B or C from monetary values.',
    'Scan discounts and promotions across the whole receipt, including discount lines that appear after an intermediate total or subtotal.',
    'Group repeated identical product rows when description, original quantity, unit price and tax category match; sum their quantities and include every supporting source line.',
    'Duplicate identical rows are not ambiguous after exact grouping. Do not leave a discount unassigned solely because the same identical product row appeared more than once.',
    'Return monetary fields as integer euro cents. lineTotalMinor is the post-discount line total.',
    'When a discount has unique product ownership, return discount as either `{type:"amount",amountMinor:<euro cents>}` or `{type:"percentage",basisPoints:<percentage times 100>}`; for example 50% is 5000 basis points.',
    'When a discount applies to only part of an aggregated quantity, set discount.quantity to the affected quantity. Omit discount.quantity only when the discount applies to the whole item quantity.',
    'Do not return both amount and percentage fields for one discount. Do not convert a visible percentage to binary floating-point arithmetic.',
    'For two identical `BEBIDA COCO 0% A` rows at 1.75 EUR followed by `50% dto BEBIDA COCO 0% A 0,88-`, return one item with quantity 2, unitPriceMinor 175, lineTotalMinor 262 and discount `{type:"percentage",basisPoints:5000,quantity:1}`.',
    'Use unassignedDiscounts only when product ownership or affected quantity is genuinely unresolved after exact grouping. Include sourceLines, a description hint when visible and a short reason. Do not repeat an unassigned-discount reason in warnings.',
    'Return sourceLines with the numbered OCR lines supporting every item and unassigned discount, even when the attachment corrects OCR characters.',
    'Return correctedText in page order, retailerName, declaredTotalMinor and articleCount only when visible in the attachment or OCR.',
    'Keep each warning and unassigned-discount reason within 240 characters.',
    'Mark other uncertainty through confidence and warnings. Return JSON only.',
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
  categoryInventory: readonly CategoryDescriptor[] = [],
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
          buildReceiptCategoryContext(categoryInventory),
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
    || discountIdentity(left) !== discountIdentity(right)
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

function discountIdentity(line: ReceiptExtractionItem): string {
  if (line.discount?.type === 'amount') {
    return `amount:${String(line.discount.amountMinor)}:${String(line.discount.quantity ?? 'all')}`;
  }
  if (line.discount?.type === 'percentage') {
    return `percentage:${String(line.discount.basisPoints)}:${String(line.discount.quantity ?? 'all')}`;
  }
  return `legacy:${String(line.discountMinor ?? 0)}`;
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
