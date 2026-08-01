import { validateReceiptLine, validateReceiptTotal } from '../domain/receipt.ts';
import { asArray, asBoolean, asEnum, asRecord, asSafeInteger, asString } from '../domain/validation.ts';
import type { ReceiptImportInput } from '../infrastructure/database.ts';

const CAPTURE_MIME_TYPES = ['image/jpeg', 'image/png', 'application/pdf'] as const;
const REVIEW_CONFIDENCE_THRESHOLD = 0.75;

export function parseReceiptConfirmation(value: unknown): Readonly<{
  input: ReceiptImportInput;
  total: ReturnType<typeof validateReceiptTotal>;
}> {
  const root = asRecord(value);
  const declaredTotalMinor = asSafeInteger(root['declaredTotalMinor'], '$.declaredTotalMinor', { min: 0 });
  const items = asArray(root['items'], '$.items', 500).map((entry, index) => {
    const item = asRecord(entry, `$.items[${index}]`);
    const line = {
      description: asString(item['description'], `$.items[${index}].description`, { min: 1, max: 240 }),
      quantity: asSafeInteger(item['quantity'], `$.items[${index}].quantity`, { min: 0, max: 100_000 }),
      unitPriceMinor: asSafeInteger(item['unitPriceMinor'], `$.items[${index}].unitPriceMinor`, { min: 0 }),
      lineTotalMinor: asSafeInteger(item['lineTotalMinor'], `$.items[${index}].lineTotalMinor`, { min: 0 }),
      ...(item['discountMinor'] === undefined ? {} : { discountMinor: asSafeInteger(item['discountMinor'], `$.items[${index}].discountMinor`, { min: 0 }) }),
    };
    const validation = validateReceiptLine(line);
    if (validation.status !== 'confirmed') throw new RangeError(`Receipt item ${index + 1} must be corrected before confirmation`);
    const confidence = item['confidence'] === undefined ? 1 : Number(item['confidence']);
    if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) throw new RangeError(`$.items[${index}].confidence must be between 0 and 1`);
    const userConfirmed = item['userConfirmed'] === undefined ? true : asBoolean(item['userConfirmed'], `$.items[${index}].userConfirmed`);
    return {
      ...line,
      status: confidence < REVIEW_CONFIDENCE_THRESHOLD && !userConfirmed ? 'needs-review' : 'confirmed',
      confidence: userConfirmed ? 1 : confidence,
    };
  });
  if (items.length === 0) throw new RangeError('At least one receipt item is required');
  const total = validateReceiptTotal(items, declaredTotalMinor);

  const captures = root['captures'] === undefined ? undefined : asArray(root['captures'], '$.captures', 20).map((entry, index) => {
    const capture = asRecord(entry, `$.captures[${index}]`);
    const originalName = typeof capture['originalName'] === 'string'
      ? asString(capture['originalName'], `$.captures[${index}].originalName`, { min: 1, max: 240 })
      : undefined;
    const contentHash = typeof capture['contentHash'] === 'string'
      ? asString(capture['contentHash'], `$.captures[${index}].contentHash`, { min: 64, max: 64 })
      : undefined;
    return {
      storageKey: asString(capture['storageKey'], `$.captures[${index}].storageKey`, { min: 8, max: 160 }),
      mimeType: asEnum(capture['mimeType'], `$.captures[${index}].mimeType`, CAPTURE_MIME_TYPES),
      ...(originalName ? { originalName } : {}),
      ...(contentHash ? { contentHash } : {}),
    };
  });

  const corrections = root['corrections'] === undefined ? undefined : asArray(root['corrections'], '$.corrections', 1_000).map((entry, index) => {
    const correction = asRecord(entry, `$.corrections[${index}]`);
    return {
      itemIndex: asSafeInteger(correction['itemIndex'], `$.corrections[${index}].itemIndex`, { min: 0, max: items.length - 1 }),
      field: asString(correction['field'], `$.corrections[${index}].field`, { min: 1, max: 80 }),
      original: correction['original'],
      corrected: correction['corrected'],
    };
  });

  const provider = asString(root['provider'] ?? 'manual-or-embedded', '$.provider', { min: 1, max: 120 });
  const retailerName = root['retailerName'] === undefined || root['retailerName'] === null || root['retailerName'] === ''
    ? undefined
    : asString(root['retailerName'], '$.retailerName', { min: 1, max: 120 });
  return {
    input: {
      importKey: asString(root['importKey'], '$.importKey', { min: 8, max: 128 }),
      declaredTotalMinor,
      originalText: asString(root['originalText'], '$.originalText', { min: 1, max: 500_000 }),
      provider,
      ...(retailerName ? { retailerName } : {}),
      deterministic: root['deterministic'] ?? items,
      ...(root['ai'] === undefined ? {} : { ai: root['ai'] }),
      ...(captures ? { captures } : {}),
      items,
      ...(corrections ? { corrections } : {}),
    },
    total,
  };
}
