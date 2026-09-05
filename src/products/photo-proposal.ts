import {
  buildAiAttachmentContentPart,
  type AiProvider,
} from '../ai/provider.ts';
import { StructuredAiExecutor, type RuntimeSchema } from '../ai/structured-executor.ts';
import { UNIT_VALUES, type Unit } from '../domain/units.ts';
import { asArray, asEnum, asOptionalString, asRecord, asSafeInteger, asString } from '../domain/validation.ts';
import type { FileStore } from '../infrastructure/files.ts';

export type ProductPhotoProposal = Readonly<{
  canonicalName?: string;
  variantName?: string;
  brand?: string;
  ean?: string;
  category?: string;
  description?: string;
  packageAmountMinor?: number;
  packageUnit?: Unit;
  quantityMinor?: number;
  unit?: Unit;
  priceMinor?: number;
  retailerName?: string;
  storeName?: string;
  confidence: number;
  warnings: readonly string[];
}>;

const PRODUCT_PHOTO_SCHEMA: RuntimeSchema<ProductPhotoProposal> = {
  jsonSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['confidence', 'warnings'],
    properties: {
      canonicalName: { type: 'string', minLength: 1, maxLength: 160 },
      variantName: { type: 'string', minLength: 1, maxLength: 160 },
      brand: { type: 'string', minLength: 1, maxLength: 120 },
      ean: { type: 'string', pattern: '^\\d{8,14}$' },
      category: { type: 'string', minLength: 1, maxLength: 120 },
      description: { type: 'string', minLength: 1, maxLength: 500 },
      packageAmountMinor: { type: 'integer', minimum: 1, maximum: 100000000 },
      packageUnit: { type: 'string', enum: UNIT_VALUES },
      quantityMinor: { type: 'integer', minimum: 1, maximum: 100000 },
      unit: { type: 'string', enum: UNIT_VALUES },
      priceMinor: { type: 'integer', minimum: 0, maximum: 100000000 },
      retailerName: { type: 'string', minLength: 1, maxLength: 160 },
      storeName: { type: 'string', minLength: 1, maxLength: 160 },
      confidence: { type: 'number', minimum: 0, maximum: 1 },
      warnings: { type: 'array', maxItems: 20, items: { type: 'string', maxLength: 240 } },
    },
  },
  parse(value: unknown) {
    const root = asRecord(value);
    const canonicalName = asOptionalString(root['canonicalName'], '$.canonicalName', { max: 160 });
    const variantName = asOptionalString(root['variantName'], '$.variantName', { max: 160 });
    const brand = asOptionalString(root['brand'], '$.brand', { max: 120 });
    const ean = asOptionalString(root['ean'], '$.ean', { max: 14 });
    if (ean && !/^\d{8,14}$/u.test(ean)) throw new RangeError('EAN/GTIN must contain 8 to 14 digits');
    const category = asOptionalString(root['category'], '$.category', { max: 120 });
    const description = asOptionalString(root['description'], '$.description', { max: 500 });
    const retailerName = asOptionalString(root['retailerName'], '$.retailerName', { max: 160 });
    const storeName = asOptionalString(root['storeName'], '$.storeName', { max: 160 });
    const confidence = Number(root['confidence']);
    if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) throw new RangeError('Product proposal confidence must be between zero and one');
    const warnings = asArray(root['warnings'], '$.warnings', 20)
      .map((warning, index) => asString(warning, `$.warnings[${index}]`, { max: 240 }));
    return {
      ...(canonicalName ? { canonicalName } : {}),
      ...(variantName ? { variantName } : {}),
      ...(brand ? { brand } : {}),
      ...(ean ? { ean } : {}),
      ...(category ? { category } : {}),
      ...(description ? { description } : {}),
      ...(root['packageAmountMinor'] === undefined ? {} : { packageAmountMinor: asSafeInteger(root['packageAmountMinor'], '$.packageAmountMinor', { min: 1, max: 100_000_000 }) }),
      ...(root['packageUnit'] === undefined ? {} : { packageUnit: asEnum(root['packageUnit'], '$.packageUnit', UNIT_VALUES) }),
      ...(root['quantityMinor'] === undefined ? {} : { quantityMinor: asSafeInteger(root['quantityMinor'], '$.quantityMinor', { min: 1, max: 100_000 }) }),
      ...(root['unit'] === undefined ? {} : { unit: asEnum(root['unit'], '$.unit', UNIT_VALUES) }),
      ...(root['priceMinor'] === undefined ? {} : { priceMinor: asSafeInteger(root['priceMinor'], '$.priceMinor', { min: 0, max: 100_000_000 }) }),
      ...(retailerName ? { retailerName } : {}),
      ...(storeName ? { storeName } : {}),
      confidence,
      warnings,
    };
  },
};

export async function proposeProductFromPhoto(input: Readonly<{
  fileStore: FileStore;
  provider: AiProvider;
  maxRetries: number;
  storageKey: string;
  contextText?: string;
  signal?: AbortSignal;
}>): Promise<Readonly<{ proposal: ProductPhotoProposal; attempts: number }>> {
  input.signal?.throwIfAborted();
  const stored = input.fileStore.read(input.storageKey);
  if (stored.mimeType !== 'image/jpeg' && stored.mimeType !== 'image/png') {
    throw new RangeError('Product photo proposal requires a JPEG or PNG image');
  }
  const attachment = buildAiAttachmentContentPart({ mimeType: stored.mimeType, bytes: stored.bytes }, await input.provider.getCapabilities());
  const executor = new StructuredAiExecutor(input.provider, input.maxRetries);
  const result = await executor.execute({
    operation: 'product-photo-proposal',
    schemaName: 'product_photo_proposal',
    reasoningEffort: 'low',
    systemPrompt: [
      'Identify a grocery product from the attached image and return only the requested structured object.',
      'Do not invent unreadable product names, brands, EAN/GTIN values, package amounts, prices, retailers or stores.',
      'Return monetary values only as integer euro cents when the price is visibly supported by the image.',
      'Treat missing information as absent rather than guessing.',
      'Use warnings for uncertainty and confidence for the overall extraction quality.',
      'A retailer or store name is evidence only when visibly present; never infer a business from visual style alone.',
    ].join(' '),
    content: [
      {
        type: 'text',
        text: input.contextText?.trim()
          ? `Optional user context (not evidence for missing facts): ${input.contextText.trim().slice(0, 500)}`
          : 'No additional user context was supplied.',
      },
      attachment,
    ],
    schema: PRODUCT_PHOTO_SCHEMA,
    ...(input.signal ? { signal: input.signal } : {}),
  });
  return { proposal: result.value, attempts: result.attempts };
}
