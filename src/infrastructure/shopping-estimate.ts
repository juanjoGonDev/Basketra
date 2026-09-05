import type { DatabaseSync } from 'node:sqlite';
import {
  UNIT_VALUES,
  multiplyRational,
  normalizeQuantity,
  normalizedMinorPerBaseUnit,
  rational,
  type Rational,
  type Unit,
} from '../domain/units.ts';

export type ShoppingEstimateUnavailableReason =
  | 'store-required'
  | 'product-required'
  | 'price-missing'
  | 'not-comparable';

export type ShoppingEstimateLine = Readonly<{
  itemId: string;
  text: string;
  quantityMinor: number;
  unit: Unit;
  productVariantId?: string;
  canonicalName?: string;
  variantName?: string;
  packageMinor?: number;
  packageUnit?: Unit;
  effectiveStoreId?: string;
  effectiveStoreName?: string;
  effectiveRetailerName?: string;
  status: 'priced' | 'unpriced';
  reason?: ShoppingEstimateUnavailableReason;
  latestPriceMinor?: number;
  observedAt?: string;
  confidence?: number;
  normalizedPriceMinor?: number;
  normalizedPriceUnit?: Unit;
  estimatedTotalMinor?: number;
}>;

export type ShoppingListEstimate = Readonly<{
  listId: string;
  referenceStoreId?: string;
  referenceStoreName?: string;
  referenceRetailerName?: string;
  totalMinor: number;
  pricedItemCount: number;
  unpricedItemCount: number;
  oldestObservedAt?: string;
  lines: readonly ShoppingEstimateLine[];
}>;

type EstimateRow = Readonly<{
  itemId: string;
  text: string;
  quantityMinor: number;
  itemUnit: string;
  productVariantId: string | null;
  canonicalName: string | null;
  variantName: string | null;
  variantPackageMinor: number | null;
  variantPackageUnit: string | null;
  effectiveStoreId: string | null;
  effectiveStoreName: string | null;
  effectiveRetailerName: string | null;
  priceMinor: number | null;
  packageNumerator: number | null;
  packageDenominator: number | null;
  packageUnit: string | null;
  observedAt: string | null;
  confidence: number | null;
}>;

const UNIT_SET = new Set<string>(UNIT_VALUES);
const MASS_VOLUME_UNITS = new Set<Unit>(['g', 'kg', 'ml', 'l']);

function asUnit(value: string | null): Unit | undefined {
  return value !== null && UNIT_SET.has(value) ? value as Unit : undefined;
}

function roundMinor(value: Rational): number {
  const quotient = Math.floor(value.numerator / value.denominator);
  const remainder = value.numerator % value.denominator;
  return quotient + (remainder * 2 >= value.denominator ? 1 : 0);
}

function massOrVolumePackage(row: EstimateRow): Readonly<{ amount: Rational; unit: Unit }> | undefined {
  const observedUnit = asUnit(row.packageUnit);
  if (
    observedUnit
    && MASS_VOLUME_UNITS.has(observedUnit)
    && row.packageNumerator !== null
    && row.packageDenominator !== null
    && row.packageNumerator > 0
    && row.packageDenominator > 0
  ) {
    return { amount: rational(row.packageNumerator, row.packageDenominator), unit: observedUnit };
  }

  const variantUnit = asUnit(row.variantPackageUnit);
  if (
    variantUnit
    && MASS_VOLUME_UNITS.has(variantUnit)
    && row.variantPackageMinor !== null
    && row.variantPackageMinor > 0
  ) {
    return { amount: rational(row.variantPackageMinor), unit: variantUnit };
  }
  return undefined;
}

function normalizedDisplayPrice(
  row: EstimateRow,
  itemUnit: Unit,
): Readonly<{ minor: number; unit: Unit }> | undefined {
  if (row.priceMinor === null) return undefined;
  const packageQuantity = massOrVolumePackage(row);
  if (packageQuantity) {
    const normalized = normalizedMinorPerBaseUnit(row.priceMinor, packageQuantity);
    const normalizedUnit = normalizeQuantity(packageQuantity).unit;
    if (normalizedUnit === 'g') {
      return { minor: roundMinor(multiplyRational(normalized, rational(1000))), unit: 'kg' };
    }
    if (normalizedUnit === 'ml') {
      return { minor: roundMinor(multiplyRational(normalized, rational(1000))), unit: 'l' };
    }
  }
  return { minor: row.priceMinor, unit: itemUnit };
}

function estimateLine(row: EstimateRow, itemUnit: Unit): ShoppingEstimateLine {
  const variantPackageUnit = asUnit(row.variantPackageUnit);
  const base = {
    itemId: row.itemId,
    text: row.text,
    quantityMinor: row.quantityMinor,
    unit: itemUnit,
    ...(row.productVariantId ? { productVariantId: row.productVariantId } : {}),
    ...(row.canonicalName ? { canonicalName: row.canonicalName } : {}),
    ...(row.variantName ? { variantName: row.variantName } : {}),
    ...(row.variantPackageMinor === null ? {} : { packageMinor: row.variantPackageMinor }),
    ...(variantPackageUnit ? { packageUnit: variantPackageUnit } : {}),
    ...(row.effectiveStoreId ? { effectiveStoreId: row.effectiveStoreId } : {}),
    ...(row.effectiveStoreName ? { effectiveStoreName: row.effectiveStoreName } : {}),
    ...(row.effectiveRetailerName ? { effectiveRetailerName: row.effectiveRetailerName } : {}),
  };

  if (!row.effectiveStoreId) return { ...base, status: 'unpriced', reason: 'store-required' };
  if (!row.productVariantId) return { ...base, status: 'unpriced', reason: 'product-required' };
  if (row.priceMinor === null || row.observedAt === null) {
    return { ...base, status: 'unpriced', reason: 'price-missing' };
  }

  let estimated: Rational;
  if (MASS_VOLUME_UNITS.has(itemUnit)) {
    const packageQuantity = massOrVolumePackage(row);
    if (!packageQuantity) return { ...base, status: 'unpriced', reason: 'not-comparable' };
    const requested = normalizeQuantity({ amount: rational(row.quantityMinor), unit: itemUnit });
    const pricedPackage = normalizeQuantity(packageQuantity);
    if (requested.unit !== pricedPackage.unit) {
      return { ...base, status: 'unpriced', reason: 'not-comparable' };
    }
    estimated = multiplyRational(
      normalizedMinorPerBaseUnit(row.priceMinor, packageQuantity),
      requested.amount,
    );
  } else {
    const multiplied = row.priceMinor * row.quantityMinor;
    if (!Number.isSafeInteger(multiplied)) {
      return { ...base, status: 'unpriced', reason: 'not-comparable' };
    }
    estimated = rational(multiplied);
  }

  const normalized = normalizedDisplayPrice(row, itemUnit);
  return {
    ...base,
    status: 'priced',
    latestPriceMinor: row.priceMinor,
    observedAt: row.observedAt,
    ...(row.confidence === null ? {} : { confidence: row.confidence }),
    ...(normalized
      ? { normalizedPriceMinor: normalized.minor, normalizedPriceUnit: normalized.unit }
      : {}),
    estimatedTotalMinor: roundMinor(estimated),
  };
}

export class ShoppingEstimateReadModel {
  readonly #database: DatabaseSync;

  constructor(database: DatabaseSync) {
    this.#database = database;
  }

  estimateList(listId: string): ShoppingListEstimate | undefined {
    const list = this.#database.prepare(`
      SELECT
        shopping_lists.id,
        shopping_lists.reference_store_id AS referenceStoreId,
        stores.name AS referenceStoreName,
        retailers.name AS referenceRetailerName
      FROM shopping_lists
      LEFT JOIN stores ON stores.id = shopping_lists.reference_store_id
      LEFT JOIN retailers ON retailers.id = stores.retailer_id
      WHERE shopping_lists.id = ?
    `).get(listId) as Readonly<{
      id: string;
      referenceStoreId: string | null;
      referenceStoreName: string | null;
      referenceRetailerName: string | null;
    }> | undefined;
    if (!list) return undefined;

    const rows = this.#database.prepare(`
      SELECT
        shopping_list_items.id AS itemId,
        shopping_list_items.text,
        shopping_list_items.quantity_minor AS quantityMinor,
        shopping_list_items.unit AS itemUnit,
        shopping_list_items.product_variant_id AS productVariantId,
        canonical_products.name AS canonicalName,
        product_variants.name AS variantName,
        product_variants.package_minor AS variantPackageMinor,
        product_variants.package_unit AS variantPackageUnit,
        effective_store.id AS effectiveStoreId,
        effective_store.name AS effectiveStoreName,
        effective_retailer.name AS effectiveRetailerName,
        price_observations.price_minor AS priceMinor,
        price_observations.package_numerator AS packageNumerator,
        price_observations.package_denominator AS packageDenominator,
        price_observations.package_unit AS packageUnit,
        price_observations.observed_at AS observedAt,
        price_observations.confidence
      FROM shopping_list_items
      JOIN shopping_lists ON shopping_lists.id = shopping_list_items.list_id
      LEFT JOIN product_variants ON product_variants.id = shopping_list_items.product_variant_id
      LEFT JOIN canonical_products ON canonical_products.id = product_variants.canonical_product_id
      LEFT JOIN stores AS effective_store
        ON effective_store.id = COALESCE(shopping_list_items.store_override_id, shopping_lists.reference_store_id)
      LEFT JOIN retailers AS effective_retailer ON effective_retailer.id = effective_store.retailer_id
      LEFT JOIN price_observations ON price_observations.id = (
        SELECT candidate.id
        FROM price_observations AS candidate
        JOIN retailer_listings AS candidate_listing
          ON candidate_listing.id = candidate.retailer_listing_id
        WHERE candidate_listing.product_variant_id = shopping_list_items.product_variant_id
          AND candidate.store_id = COALESCE(shopping_list_items.store_override_id, shopping_lists.reference_store_id)
        ORDER BY candidate.observed_at DESC, candidate.id DESC
        LIMIT 1
      )
      WHERE shopping_list_items.list_id = ? AND shopping_list_items.completed = 0
      ORDER BY shopping_list_items.position, shopping_list_items.id
    `).all(listId) as EstimateRow[];

    const lines = rows.map((row): ShoppingEstimateLine => {
      const unit = asUnit(row.itemUnit);
      if (!unit) {
        return {
          itemId: row.itemId,
          text: row.text,
          quantityMinor: row.quantityMinor,
          unit: 'unit',
          status: 'unpriced',
          reason: 'not-comparable',
        };
      }
      return estimateLine(row, unit);
    });
    const priced = lines.filter((line) => line.status === 'priced');
    const timestamps = priced.flatMap((line) => line.observedAt ? [line.observedAt] : []);

    return {
      listId,
      ...(list.referenceStoreId ? { referenceStoreId: list.referenceStoreId } : {}),
      ...(list.referenceStoreName ? { referenceStoreName: list.referenceStoreName } : {}),
      ...(list.referenceRetailerName ? { referenceRetailerName: list.referenceRetailerName } : {}),
      totalMinor: priced.reduce((sum, line) => sum + (line.estimatedTotalMinor ?? 0), 0),
      pricedItemCount: priced.length,
      unpricedItemCount: lines.length - priced.length,
      ...(timestamps.length
        ? { oldestObservedAt: timestamps.reduce((oldest, value) => value < oldest ? value : oldest) }
        : {}),
      lines,
    };
  }
}
