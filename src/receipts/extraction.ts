import type { AiProvider } from '../ai/provider.ts';
import { StructuredAiExecutor, type RuntimeSchema } from '../ai/structured-executor.ts';
import { deduplicateOverlappingLines, validateReceiptLine, validateReceiptTotal, type ReceiptLineInput } from '../domain/receipt.ts';
import { asArray, asEnum, asRecord, asSafeInteger, asString } from '../domain/validation.ts';

const CURRENCIES = ['EUR'] as const;
const REVIEW_CONFIDENCE_THRESHOLD = 0.75;

export type ReceiptExtractionItem = ReceiptLineInput & Readonly<{ confidence: number }>;
export type AiReceiptInterpretation = Readonly<{
  retailerName?: string;
  purchasedAt?: string;
  declaredTotalMinor?: number;
  currency: 'EUR';
  items: readonly ReceiptExtractionItem[];
  warnings: readonly string[];
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

const RECEIPT_SCHEMA: RuntimeSchema<AiReceiptInterpretation> = {
  jsonSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['currency', 'items', 'warnings'],
    properties: {
      retailerName: { type: 'string', minLength: 1, maxLength: 160 },
      purchasedAt: { type: 'string', minLength: 10, maxLength: 40 },
      declaredTotalMinor: { type: 'integer', minimum: 0 },
      currency: { type: 'string', enum: CURRENCIES },
      items: {
        type: 'array',
        maxItems: 500,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['description', 'quantity', 'unitPriceMinor', 'lineTotalMinor', 'confidence'],
          properties: {
            description: { type: 'string', maxLength: 240 },
            quantity: { type: 'integer', minimum: 0, maximum: 100_000 },
            unitPriceMinor: { type: 'integer', minimum: 0 },
            lineTotalMinor: { type: 'integer', minimum: 0 },
            discountMinor: { type: 'integer', minimum: 0 },
            confidence: { type: 'number', minimum: 0, maximum: 1 },
          },
        },
      },
      warnings: { type: 'array', maxItems: 100, items: { type: 'string', maxLength: 240 } },
    },
  },
  parse(value: unknown) {
    const root = asRecord(value);
    const retailerName = typeof root['retailerName'] === 'string' ? asString(root['retailerName'], '$.retailerName', { min: 1, max: 160 }) : undefined;
    const purchasedAt = typeof root['purchasedAt'] === 'string' ? asString(root['purchasedAt'], '$.purchasedAt', { min: 10, max: 40 }) : undefined;
    const declaredTotalMinor = root['declaredTotalMinor'] === undefined ? undefined : asSafeInteger(root['declaredTotalMinor'], '$.declaredTotalMinor', { min: 0 });
    const items = asArray(root['items'], '$.items', 500).map((entry, index): ReceiptExtractionItem => {
      const item = asRecord(entry, `$.items[${index}]`);
      const confidence = Number(item['confidence']);
      if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) throw new RangeError(`$.items[${index}].confidence must be between 0 and 1`);
      return {
        description: asString(item['description'], `$.items[${index}].description`, { max: 240 }),
        quantity: asSafeInteger(item['quantity'], `$.items[${index}].quantity`, { min: 0, max: 100_000 }),
        unitPriceMinor: asSafeInteger(item['unitPriceMinor'], `$.items[${index}].unitPriceMinor`, { min: 0 }),
        lineTotalMinor: asSafeInteger(item['lineTotalMinor'], `$.items[${index}].lineTotalMinor`, { min: 0 }),
        ...(item['discountMinor'] === undefined ? {} : { discountMinor: asSafeInteger(item['discountMinor'], `$.items[${index}].discountMinor`, { min: 0 }) }),
        confidence,
      };
    });
    const warnings = asArray(root['warnings'], '$.warnings', 100).map((warning, index) => asString(warning, `$.warnings[${index}]`, { max: 240 }));
    return {
      ...(retailerName ? { retailerName } : {}),
      ...(purchasedAt ? { purchasedAt } : {}),
      ...(declaredTotalMinor === undefined ? {} : { declaredTotalMinor }),
      currency: asEnum(root['currency'], '$.currency', CURRENCIES),
      items,
      warnings,
    };
  },
};

export function parseDeterministicReceiptText(text: string): ReceiptExtractionItem[] {
  const items: ReceiptExtractionItem[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const delimited = /^(.*?)[;|]\s*(\d+)\s*[;|]\s*(\d+)\s*[;|]\s*(\d+)(?:\s*[;|]\s*(\d+))?$/.exec(line);
    if (delimited?.[1] && delimited[2] && delimited[3] && delimited[4]) {
      items.push({
        description: delimited[1].trim(),
        quantity: parseSafeInteger(delimited[2]),
        unitPriceMinor: parseSafeInteger(delimited[3]),
        lineTotalMinor: parseSafeInteger(delimited[4]),
        ...(delimited[5] ? { discountMinor: parseSafeInteger(delimited[5]) } : {}),
        confidence: 1,
      });
      continue;
    }
    const multiplied = /^(.*?)\s+(\d+)\s*[xX]\s*(\d[\d.,]*[.,]\d{2})\s+(\d[\d.,]*[.,]\d{2})$/.exec(line);
    if (multiplied?.[1] && multiplied[2] && multiplied[3] && multiplied[4]) {
      items.push({
        description: multiplied[1].trim(),
        quantity: parseSafeInteger(multiplied[2]),
        unitPriceMinor: parsePriceMinor(multiplied[3]),
        lineTotalMinor: parsePriceMinor(multiplied[4]),
        confidence: 0.95,
      });
      continue;
    }
    const priced = /^(.*?)\s+(\d[\d.,]*[.,]\d{2})$/.exec(line);
    if (priced?.[1] && priced[2] && !isReceiptSummaryLabel(priced[1])) {
      const priceMinor = parsePriceMinor(priced[2]);
      items.push({ description: priced[1].trim(), quantity: 1, unitPriceMinor: priceMinor, lineTotalMinor: priceMinor, confidence: 0.7 });
    }
  }
  return deduplicateOverlappingLines(items).map((line) => {
    const original = items.find((item) => sameLine(item, line));
    return { ...line, confidence: original?.confidence ?? 0.5 };
  });
}

export function extractDeclaredTotalMinor(text: string): number | undefined {
  for (const rawLine of text.split(/\r?\n/).reverse()) {
    const match = /^\s*(?:total|importe|a pagar)\b.*?(\d[\d.,]*[.,]\d{2})\s*(?:€|eur)?\s*$/i.exec(rawLine);
    if (match?.[1]) return parsePriceMinor(match[1]);
  }
  return undefined;
}

export function buildReceiptReview(items: readonly ReceiptExtractionItem[], declaredTotalMinor?: number): ReceiptReview {
  const lines = items.map((item): ReceiptReviewLine => {
    const validation = validateReceiptLine(item);
    return {
      ...item,
      status: validation.status === 'confirmed' && item.confidence < REVIEW_CONFIDENCE_THRESHOLD ? 'needs-review' : validation.status,
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
  signal?: AbortSignal,
): Promise<Readonly<{ value: AiReceiptInterpretation; attempts: number }>> {
  const executor = new StructuredAiExecutor(provider, maxRetries);
  const result = await executor.execute({
    operation: 'receipt-verification',
    schemaName: 'receipt_verification',
    systemPrompt: 'Interpret grocery receipt OCR without inventing unreadable products. Reconstruct split lines only when supported by the text. Preserve discounts, quantities and totals. Monetary fields are integer euro cents. Mark uncertainty through confidence and warnings. Return JSON only.',
    content: originalText,
    schema: RECEIPT_SCHEMA,
    ...(signal ? { signal } : {}),
  });
  return result;
}

function parseSafeInteger(value: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new RangeError('Receipt value is not a non-negative safe integer');
  return parsed;
}

function parsePriceMinor(value: string): number {
  const compact = value.replace(/\s/g, '');
  const separator = Math.max(compact.lastIndexOf(','), compact.lastIndexOf('.'));
  if (separator <= 0 || compact.length - separator !== 3) throw new RangeError('Receipt price must have two decimal places');
  const whole = compact.slice(0, separator).replace(/[.,]/g, '');
  const fraction = compact.slice(separator + 1);
  if (!/^\d+$/.test(whole) || !/^\d{2}$/.test(fraction)) throw new RangeError('Receipt price is malformed');
  return parseSafeInteger(`${whole}${fraction}`);
}

function isReceiptSummaryLabel(label: string): boolean {
  return /^(?:sub\s*total|total|importe|a pagar|efectivo|tarjeta|cambio|iva|base imponible)\b/i.test(label.trim());
}

function sameLine(left: ReceiptLineInput, right: ReceiptLineInput): boolean {
  return left.description === right.description
    && left.quantity === right.quantity
    && left.unitPriceMinor === right.unitPriceMinor
    && left.lineTotalMinor === right.lineTotalMinor
    && (left.discountMinor ?? 0) === (right.discountMinor ?? 0);
}
