import type { DatabaseSync } from 'node:sqlite';
import { rankNearbyStores, type GeoPointMicrodegrees } from '../domain/location.ts';
import { normalizedMinorPerBaseUnit, rational, type Unit } from '../domain/units.ts';
import { createId } from './ids.ts';

export type ProductCategoryRecord = Readonly<{
  id: string;
  name: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
}>;

export type ProductParentSuggestionRecord = Readonly<{
  id: string;
  name: string;
  categoryId?: string;
  categoryName?: string;
  description?: string;
  variantCount: number;
}>;

export type ProductSuggestionRecord = Readonly<{
  id: string;
  name: string;
  source: 'catalog';
  canonicalName: string;
  brand?: string;
  categoryId?: string;
  categoryName?: string;
}>;

export type ProductVariantRecord = Readonly<{
  id: string;
  canonicalProductId: string;
  canonicalName: string;
  variantName: string;
  description?: string;
  brand?: string;
  ean?: string;
  packageMinor?: number;
  packageUnit?: string;
  categoryId?: string;
  categoryName?: string;
  aliases: readonly string[];
  createdAt: string;
  updatedAt: string;
}>;

export type StoreRecord = Readonly<{
  id: string;
  retailerId: string;
  retailerName: string;
  name: string;
  region?: string;
  address?: string;
  latitudeMicrodegrees?: number;
  longitudeMicrodegrees?: number;
  osmType?: 'node' | 'way' | 'relation';
  osmId?: string;
  lastUsedAt?: string;
}>;

export type PriceObservationRecord = Readonly<{
  id: string;
  productVariantId: string;
  retailerId: string;
  retailerName: string;
  storeId?: string;
  storeName?: string;
  priceMinor: number;
  packageNumerator: number;
  packageDenominator: number;
  packageUnit: string;
  normalizedPriceNumerator: number;
  normalizedPriceDenominator: number;
  evidenceId: string;
  observedAt: string;
  confidence: number;
}>;

export type ProductTicketHistoryRecord = Readonly<{
  receiptId: string;
  purchasedAt: string;
  retailerName?: string;
  storeName?: string;
  quantity: number;
  unit: string;
  lineTotalMinor: number;
}>;

type CategoryRow = Readonly<{
  id: string;
  name: string;
  description: string | null;
  createdAt: string;
  updatedAt: string;
}>;

type ProductVariantRow = Readonly<{
  id: string;
  canonicalProductId: string;
  canonicalName: string;
  variantName: string;
  description: string | null;
  brand: string | null;
  ean: string | null;
  packageMinor: number | null;
  packageUnit: string | null;
  categoryId: string | null;
  categoryName: string | null;
  createdAt: string;
  updatedAt: string;
}>;

type StoreRow = Readonly<{
  id: string;
  retailerId: string;
  retailerName: string;
  name: string;
  region: string | null;
  address: string | null;
  latitudeMicrodegrees: number | null;
  longitudeMicrodegrees: number | null;
  osmType: 'node' | 'way' | 'relation' | null;
  osmId: string | null;
  lastUsedAt: string | null;
}>;

function mapCategory(row: CategoryRow): ProductCategoryRecord {
  return {
    id: row.id,
    name: row.name,
    ...(row.description ? { description: row.description } : {}),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapStore(row: StoreRow): StoreRecord {
  return {
    id: row.id,
    retailerId: row.retailerId,
    retailerName: row.retailerName,
    name: row.name,
    ...(row.region ? { region: row.region } : {}),
    ...(row.address ? { address: row.address } : {}),
    ...(row.latitudeMicrodegrees === null ? {} : { latitudeMicrodegrees: row.latitudeMicrodegrees }),
    ...(row.longitudeMicrodegrees === null ? {} : { longitudeMicrodegrees: row.longitudeMicrodegrees }),
    ...(row.osmType ? { osmType: row.osmType } : {}),
    ...(row.osmId ? { osmId: row.osmId } : {}),
    ...(row.lastUsedAt ? { lastUsedAt: row.lastUsedAt } : {}),
  };
}

function normalizeAlias(value: string): string {
  return value.trim().toLocaleLowerCase('es-ES');
}

export class CatalogRepository {
  readonly #database: DatabaseSync;
  readonly #clock: () => Date;

  constructor(database: DatabaseSync, clock: () => Date) {
    this.#database = database;
    this.#clock = clock;
  }

  listCategories(): ProductCategoryRecord[] {
    const rows = this.#database.prepare(`
      SELECT id, name, description, created_at AS createdAt, updated_at AS updatedAt
      FROM product_categories
      ORDER BY name COLLATE NOCASE, id
    `).all() as CategoryRow[];
    return rows.map(mapCategory);
  }

  getOrCreateCategory(name: string, description?: string): ProductCategoryRecord {
    const normalizedName = name.trim();
    if (!normalizedName) throw new RangeError('Category name is required');
    const existing = this.#database.prepare(`
      SELECT id, name, description, created_at AS createdAt, updated_at AS updatedAt
      FROM product_categories
      WHERE name = ? COLLATE NOCASE
    `).get(normalizedName) as CategoryRow | undefined;
    if (existing) return mapCategory(existing);
    const id = createId('category');
    const timestamp = this.#clock().toISOString();
    this.#database.prepare(`
      INSERT INTO product_categories(id, name, description, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, normalizedName, description?.trim() || null, timestamp, timestamp);
    return { id, name: normalizedName, ...(description?.trim() ? { description: description.trim() } : {}), createdAt: timestamp, updatedAt: timestamp };
  }

  updateCategory(id: string, input: Readonly<{ name: string; description?: string | null }>): ProductCategoryRecord | undefined {
    const name = input.name.trim();
    if (!name) throw new RangeError('Category name is required');
    const timestamp = this.#clock().toISOString();
    const result = this.#database.prepare(`
      UPDATE product_categories
      SET name = ?, description = ?, updated_at = ?
      WHERE id = ?
    `).run(name, input.description?.trim() || null, timestamp, id);
    if (Number(result.changes) === 0) return undefined;
    this.#database.prepare(`
      UPDATE canonical_products
      SET category = ?, updated_at = ?
      WHERE category_id = ?
    `).run(name, timestamp, id);
    const row = this.#database.prepare(`
      SELECT id, name, description, created_at AS createdAt, updated_at AS updatedAt
      FROM product_categories WHERE id = ?
    `).get(id) as CategoryRow;
    return mapCategory(row);
  }

  searchProducts(query: string, limit: number): ProductSuggestionRecord[] {
    const normalized = query.trim().replace(/["*:^()]/g, ' ');
    if (!normalized) return [];
    const rows = this.#database.prepare(`
      SELECT
        product_variants.id,
        product_variants.name,
        canonical_products.name AS canonicalName,
        product_variants.brand,
        product_categories.id AS categoryId,
        product_categories.name AS categoryName
      FROM product_search
      JOIN product_variants ON product_variants.id = product_search.entity_id
      JOIN canonical_products ON canonical_products.id = product_variants.canonical_product_id
      LEFT JOIN product_categories ON product_categories.id = canonical_products.category_id
      WHERE product_search MATCH ?
      ORDER BY bm25(product_search)
      LIMIT ?
    `).all(`${normalized}*`, limit) as Array<Readonly<{
      id: string;
      name: string;
      canonicalName: string;
      brand: string | null;
      categoryId: string | null;
      categoryName: string | null;
    }>>;
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      source: 'catalog',
      canonicalName: row.canonicalName,
      ...(row.brand ? { brand: row.brand } : {}),
      ...(row.categoryId ? { categoryId: row.categoryId } : {}),
      ...(row.categoryName ? { categoryName: row.categoryName } : {}),
    }));
  }

  searchCanonicalProducts(query: string, limit: number): ProductParentSuggestionRecord[] {
    const normalized = query.trim();
    if (!normalized) return [];
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 20) {
      throw new RangeError('Canonical product suggestion limit is invalid');
    }
    const escaped = normalized.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_');
    const rows = this.#database.prepare(`
      SELECT
        canonical_products.id,
        canonical_products.name,
        product_categories.id AS categoryId,
        product_categories.name AS categoryName,
        canonical_products.description,
        COUNT(product_variants.id) AS variantCount
      FROM canonical_products
      LEFT JOIN product_categories ON product_categories.id = canonical_products.category_id
      LEFT JOIN product_variants ON product_variants.canonical_product_id = canonical_products.id
      WHERE canonical_products.name LIKE ? ESCAPE '\\' COLLATE NOCASE
      GROUP BY canonical_products.id, product_categories.id
      ORDER BY canonical_products.name COLLATE NOCASE, canonical_products.id
      LIMIT ?
    `).all(`%${escaped}%`, limit) as Array<Readonly<{
      id: string;
      name: string;
      categoryId: string | null;
      categoryName: string | null;
      description: string | null;
      variantCount: number;
    }>>;
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      ...(row.categoryId ? { categoryId: row.categoryId } : {}),
      ...(row.categoryName ? { categoryName: row.categoryName } : {}),
      ...(row.description ? { description: row.description } : {}),
      variantCount: Number(row.variantCount),
    }));
  }

  getProductVariant(id: string): ProductVariantRecord | undefined {
    const row = this.#database.prepare(`
      SELECT
        product_variants.id,
        canonical_products.id AS canonicalProductId,
        canonical_products.name AS canonicalName,
        product_variants.name AS variantName,
        canonical_products.description,
        product_variants.brand,
        product_variants.ean,
        product_variants.package_minor AS packageMinor,
        product_variants.package_unit AS packageUnit,
        product_categories.id AS categoryId,
        product_categories.name AS categoryName,
        product_variants.created_at AS createdAt,
        product_variants.updated_at AS updatedAt
      FROM product_variants
      JOIN canonical_products ON canonical_products.id = product_variants.canonical_product_id
      LEFT JOIN product_categories ON product_categories.id = canonical_products.category_id
      WHERE product_variants.id = ?
    `).get(id) as ProductVariantRow | undefined;
    if (!row) return undefined;
    const aliases = (this.#database.prepare(`
      SELECT alias FROM product_aliases WHERE product_variant_id = ? ORDER BY created_at, id
    `).all(id) as Array<{ alias: string }>).map((alias) => alias.alias);
    return {
      id: row.id,
      canonicalProductId: row.canonicalProductId,
      canonicalName: row.canonicalName,
      variantName: row.variantName,
      ...(row.description ? { description: row.description } : {}),
      ...(row.brand ? { brand: row.brand } : {}),
      ...(row.ean ? { ean: row.ean } : {}),
      ...(row.packageMinor === null ? {} : { packageMinor: row.packageMinor }),
      ...(row.packageUnit ? { packageUnit: row.packageUnit } : {}),
      ...(row.categoryId ? { categoryId: row.categoryId } : {}),
      ...(row.categoryName ? { categoryName: row.categoryName } : {}),
      aliases,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  createProduct(input: Readonly<{
    canonicalProductId?: string;
    canonicalName?: string;
    variantName?: string;
    categoryId?: string;
    description?: string;
    brand?: string;
    ean?: string;
    packageMinor?: number;
    packageUnit?: string;
    aliases?: readonly string[];
  }>): ProductVariantRecord {
    const parentId = input.canonicalProductId?.trim();
    const canonicalName = input.canonicalName?.trim();
    if (parentId && (canonicalName || input.categoryId || input.description)) {
      throw new RangeError('Existing canonical product creation accepts variant fields only');
    }
    if (!parentId && !canonicalName) throw new RangeError('Canonical product name is required');

    const existingParent = parentId
      ? this.#database.prepare('SELECT id, name FROM canonical_products WHERE id = ?').get(parentId) as { id: string; name: string } | undefined
      : undefined;
    if (parentId && !existingParent) throw new Error('CANONICAL_PRODUCT_NOT_FOUND');

    const resolvedCanonicalName = existingParent?.name ?? canonicalName!;
    const variantName = input.variantName?.trim() || resolvedCanonicalName;
    if (!variantName) throw new RangeError('Product variant name is required');
    const category = !parentId && input.categoryId ? this.categoryById(input.categoryId) : undefined;
    if (!parentId && input.categoryId && !category) throw new Error('PRODUCT_CATEGORY_NOT_FOUND');

    const productId = existingParent?.id ?? createId('product');
    const variantId = createId('variant');
    const timestamp = this.#clock().toISOString();
    this.#database.exec('BEGIN IMMEDIATE');
    try {
      if (!existingParent) {
        this.#database.prepare(`
          INSERT INTO canonical_products(id, name, category, category_id, description, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(
          productId,
          resolvedCanonicalName,
          category?.name ?? null,
          category?.id ?? null,
          input.description?.trim() || null,
          timestamp,
          timestamp,
        );
      }
      this.#database.prepare(`
        INSERT INTO product_variants(id, canonical_product_id, name, brand, ean, package_minor, package_unit, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        variantId,
        productId,
        variantName,
        input.brand?.trim() || null,
        input.ean?.trim() || null,
        input.packageMinor ?? null,
        input.packageUnit?.trim() || null,
        timestamp,
        timestamp,
      );
      this.replaceAliases(variantId, input.aliases ?? [], timestamp);
      this.refreshSearchIndex(variantId);
      this.#database.exec('COMMIT');
    } catch (error) {
      this.#database.exec('ROLLBACK');
      throw error;
    }
    const created = this.getProductVariant(variantId);
    if (!created) throw new Error('PRODUCT_VARIANT_NOT_FOUND');
    return created;
  }

  updateProduct(input: Readonly<{
    variantId: string;
    canonicalName: string;
    variantName: string;
    categoryId?: string | null;
    description?: string | null;
    brand?: string | null;
    ean?: string | null;
    packageMinor?: number | null;
    packageUnit?: string | null;
    aliases?: readonly string[];
  }>): ProductVariantRecord | undefined {
    const current = this.getProductVariant(input.variantId);
    if (!current) return undefined;
    const canonicalName = input.canonicalName.trim();
    const variantName = input.variantName.trim();
    if (!canonicalName || !variantName) throw new RangeError('Product name is required');
    const category = input.categoryId ? this.categoryById(input.categoryId) : undefined;
    if (input.categoryId && !category) throw new Error('PRODUCT_CATEGORY_NOT_FOUND');
    const timestamp = this.#clock().toISOString();
    this.#database.exec('BEGIN IMMEDIATE');
    try {
      this.#database.prepare(`
        UPDATE canonical_products
        SET name = ?, category = ?, category_id = ?, description = ?, updated_at = ?
        WHERE id = ?
      `).run(canonicalName, category?.name ?? null, category?.id ?? null, input.description?.trim() || null, timestamp, current.canonicalProductId);
      this.#database.prepare(`
        UPDATE product_variants
        SET name = ?, brand = ?, ean = ?, package_minor = ?, package_unit = ?, updated_at = ?
        WHERE id = ?
      `).run(
        variantName,
        input.brand?.trim() || null,
        input.ean?.trim() || null,
        input.packageMinor ?? null,
        input.packageUnit?.trim() || null,
        timestamp,
        input.variantId,
      );
      if (input.aliases) this.replaceAliases(input.variantId, input.aliases, timestamp);
      this.refreshSearchIndex(input.variantId);
      this.#database.exec('COMMIT');
    } catch (error) {
      this.#database.exec('ROLLBACK');
      throw error;
    }
    return this.getProductVariant(input.variantId);
  }

  listStores(origin?: GeoPointMicrodegrees, maximumDistanceMeters = 5_000, limit = 12): Array<StoreRecord & Readonly<{ distanceMeters?: number }>> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50) throw new RangeError('Store limit is invalid');
    const rows = this.#database.prepare(`
      SELECT
        stores.id,
        stores.retailer_id AS retailerId,
        retailers.name AS retailerName,
        stores.name,
        stores.region,
        stores.address,
        stores.latitude_microdegrees AS latitudeMicrodegrees,
        stores.longitude_microdegrees AS longitudeMicrodegrees,
        stores.osm_type AS osmType,
        stores.osm_id AS osmId,
        MAX(price_observations.observed_at) AS lastUsedAt
      FROM stores
      JOIN retailers ON retailers.id = stores.retailer_id
      LEFT JOIN price_observations ON price_observations.store_id = stores.id
      GROUP BY stores.id, retailers.name
      ORDER BY lastUsedAt DESC, stores.created_at DESC, stores.id
    `).all() as StoreRow[];
    const mapped = rows.map(mapStore);
    if (!origin) return mapped.slice(0, limit);
    const located = mapped.filter((store): store is StoreRecord & Required<Pick<StoreRecord, 'latitudeMicrodegrees' | 'longitudeMicrodegrees'>> =>
      store.latitudeMicrodegrees !== undefined && store.longitudeMicrodegrees !== undefined);
    return rankNearbyStores(origin, located, maximumDistanceMeters).slice(0, limit);
  }

  saveStore(input: Readonly<{
    retailerName: string;
    name: string;
    region?: string;
    address?: string;
    latitudeMicrodegrees?: number;
    longitudeMicrodegrees?: number;
    osmType?: 'node' | 'way' | 'relation';
    osmId?: string;
  }>): StoreRecord {
    const retailerId = this.resolveRetailer(input.retailerName);
    if ((input.latitudeMicrodegrees === undefined) !== (input.longitudeMicrodegrees === undefined)) {
      throw new RangeError('Store coordinates must provide both latitude and longitude');
    }
    if ((input.osmType === undefined) !== (input.osmId === undefined)) {
      throw new RangeError('OSM identity must provide both type and id');
    }
    const existing = input.osmType && input.osmId
      ? this.#database.prepare('SELECT id FROM stores WHERE osm_type = ? AND osm_id = ?').get(input.osmType, input.osmId) as { id: string } | undefined
      : undefined;
    const id = existing?.id ?? createId('store');
    const timestamp = this.#clock().toISOString();
    if (existing) {
      this.#database.prepare(`
        UPDATE stores
        SET retailer_id = ?, name = ?, region = ?, address = ?, latitude_microdegrees = ?, longitude_microdegrees = ?
        WHERE id = ?
      `).run(
        retailerId,
        input.name.trim(),
        input.region?.trim() || null,
        input.address?.trim() || null,
        input.latitudeMicrodegrees ?? null,
        input.longitudeMicrodegrees ?? null,
        id,
      );
    } else {
      this.#database.prepare(`
        INSERT INTO stores(id, retailer_id, name, region, address, latitude_microdegrees, longitude_microdegrees, osm_type, osm_id, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        retailerId,
        input.name.trim(),
        input.region?.trim() || null,
        input.address?.trim() || null,
        input.latitudeMicrodegrees ?? null,
        input.longitudeMicrodegrees ?? null,
        input.osmType ?? null,
        input.osmId ?? null,
        timestamp,
      );
    }
    const store = this.storeById(id);
    if (!store) throw new Error('STORE_NOT_FOUND');
    return store;
  }

  confirmPriceObservation(input: Readonly<{
    productVariantId: string;
    retailerName: string;
    storeId?: string;
    priceMinor: number;
    packageNumerator: number;
    packageDenominator: number;
    packageUnit: Unit;
    observedAt: string;
    confidence: number;
    evidence: Readonly<{
      sourceType: 'product-photo' | 'manual' | 'receipt';
      sourceReference: string;
      contentHash?: string;
    }>;
  }>): PriceObservationRecord {
    const variant = this.getProductVariant(input.productVariantId);
    if (!variant) throw new Error('PRODUCT_VARIANT_NOT_FOUND');
    if (!input.retailerName.trim()) throw new RangeError('A retailer is required for price history');
    if (!Number.isSafeInteger(input.priceMinor) || input.priceMinor < 0) throw new RangeError('Price must be a non-negative safe integer');
    if (!Number.isFinite(input.confidence) || input.confidence < 0 || input.confidence > 1) throw new RangeError('Price confidence must be between zero and one');
    const packageAmount = rational(input.packageNumerator, input.packageDenominator);
    if (packageAmount.numerator === 0) throw new RangeError('Price package quantity must be greater than zero');
    const normalized = normalizedMinorPerBaseUnit(input.priceMinor, { amount: packageAmount, unit: input.packageUnit });
    const timestamp = this.#clock().toISOString();
    this.#database.exec('BEGIN IMMEDIATE');
    try {
      const retailerId = this.resolveRetailer(input.retailerName);
      let storeName: string | undefined;
      if (input.storeId) {
        const store = this.#database.prepare('SELECT retailer_id AS retailerId, name FROM stores WHERE id = ?').get(input.storeId) as { retailerId: string; name: string } | undefined;
        if (!store) throw new Error('STORE_NOT_FOUND');
        if (store.retailerId !== retailerId) throw new RangeError('Store does not belong to the selected retailer');
        storeName = store.name;
      }
      let listing = this.#database.prepare(`
        SELECT id FROM retailer_listings
        WHERE retailer_id = ? AND product_variant_id = ?
        ORDER BY created_at, id
        LIMIT 1
      `).get(retailerId, input.productVariantId) as { id: string } | undefined;
      if (!listing) {
        listing = { id: createId('listing') };
        this.#database.prepare(`
          INSERT INTO retailer_listings(id, retailer_id, product_variant_id, title, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(listing.id, retailerId, input.productVariantId, variant.variantName, timestamp, timestamp);
      }
      const evidenceId = createId('evidence');
      this.#database.prepare(`
        INSERT INTO external_evidence(id, source_type, source_reference, observed_at, content_hash, metadata_json, created_at)
        VALUES (?, ?, ?, ?, ?, '{}', ?)
      `).run(
        evidenceId,
        input.evidence.sourceType,
        input.evidence.sourceReference,
        input.observedAt,
        input.evidence.contentHash ?? null,
        timestamp,
      );
      const observationId = createId('price');
      this.#database.prepare(`
        INSERT INTO price_observations(
          id, retailer_listing_id, retailer_id, store_id, price_minor,
          package_numerator, package_denominator, package_unit,
          normalized_price_numerator, normalized_price_denominator,
          currency, stock_state, shipping_minor, promotion_json, conditions_json,
          evidence_id, observed_at, confidence, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'EUR', 'unknown', 0, '{}', '[]', ?, ?, ?, ?)
      `).run(
        observationId,
        listing.id,
        retailerId,
        input.storeId ?? null,
        input.priceMinor,
        packageAmount.numerator,
        packageAmount.denominator,
        input.packageUnit,
        normalized.numerator,
        normalized.denominator,
        evidenceId,
        input.observedAt,
        input.confidence,
        timestamp,
      );
      this.#database.exec('COMMIT');
      return {
        id: observationId,
        productVariantId: input.productVariantId,
        retailerId,
        retailerName: input.retailerName,
        ...(input.storeId ? { storeId: input.storeId, ...(storeName ? { storeName } : {}) } : {}),
        priceMinor: input.priceMinor,
        packageNumerator: packageAmount.numerator,
        packageDenominator: packageAmount.denominator,
        packageUnit: input.packageUnit,
        normalizedPriceNumerator: normalized.numerator,
        normalizedPriceDenominator: normalized.denominator,
        evidenceId,
        observedAt: input.observedAt,
        confidence: input.confidence,
      };
    } catch (error) {
      this.#database.exec('ROLLBACK');
      throw error;
    }
  }

  listPriceObservations(productVariantId: string, limit = 180): PriceObservationRecord[] {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 180) {
      throw new RangeError('Price history limit must be between 1 and 180');
    }
    return this.#database.prepare(`
      SELECT
        price_observations.id,
        retailer_listings.product_variant_id AS productVariantId,
        price_observations.retailer_id AS retailerId,
        retailers.name AS retailerName,
        price_observations.store_id AS storeId,
        stores.name AS storeName,
        price_observations.price_minor AS priceMinor,
        price_observations.package_numerator AS packageNumerator,
        price_observations.package_denominator AS packageDenominator,
        price_observations.package_unit AS packageUnit,
        price_observations.normalized_price_numerator AS normalizedPriceNumerator,
        price_observations.normalized_price_denominator AS normalizedPriceDenominator,
        price_observations.evidence_id AS evidenceId,
        price_observations.observed_at AS observedAt,
        price_observations.confidence
      FROM price_observations
      JOIN retailer_listings ON retailer_listings.id = price_observations.retailer_listing_id
      JOIN retailers ON retailers.id = price_observations.retailer_id
      LEFT JOIN stores ON stores.id = price_observations.store_id
      WHERE retailer_listings.product_variant_id = ?
      ORDER BY price_observations.observed_at DESC, price_observations.id DESC
      LIMIT ?
    `).all(productVariantId, limit).map((row) => {
      const value = row as Omit<PriceObservationRecord, 'storeId' | 'storeName'> & {
        storeId: string | null;
        storeName: string | null;
      };
      const { storeId, storeName, ...base } = value;
      return {
        ...base,
        ...(storeId ? { storeId } : {}),
        ...(storeName ? { storeName } : {}),
      };
    }) as PriceObservationRecord[];
  }

  listProductTicketHistory(productVariantId: string, limit = 90): ProductTicketHistoryRecord[] {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 90) {
      throw new RangeError('Product ticket history limit must be between 1 and 90');
    }
    return this.#database.prepare(`
      SELECT
        receipt_items.receipt_id AS receiptId,
        COALESCE(receipts.purchased_at, receipts.created_at) AS purchasedAt,
        retailers.name AS retailerName,
        stores.name AS storeName,
        receipt_items.quantity,
        receipt_items.unit,
        receipt_items.line_total_minor AS lineTotalMinor
      FROM receipt_items
      JOIN receipts ON receipts.id = receipt_items.receipt_id
      LEFT JOIN retailers ON retailers.id = receipts.retailer_id
      LEFT JOIN stores ON stores.id = receipts.store_id
      WHERE receipt_items.product_variant_id = ?
        AND receipt_items.status = 'confirmed'
      ORDER BY COALESCE(receipts.purchased_at, receipts.created_at) DESC, receipts.id DESC, receipt_items.id DESC
      LIMIT ?
    `).all(productVariantId, limit).map((row) => {
      const value = row as ProductTicketHistoryRecord & { retailerName: string | null; storeName: string | null };
      const { retailerName, storeName, ...base } = value;
      return {
        ...base,
        ...(retailerName ? { retailerName } : {}),
        ...(storeName ? { storeName } : {}),
      };
    }) as ProductTicketHistoryRecord[];
  }

  private categoryById(id: string): ProductCategoryRecord | undefined {
    const row = this.#database.prepare(`
      SELECT id, name, description, created_at AS createdAt, updated_at AS updatedAt
      FROM product_categories WHERE id = ?
    `).get(id) as CategoryRow | undefined;
    return row ? mapCategory(row) : undefined;
  }

  private replaceAliases(variantId: string, aliases: readonly string[], timestamp: string): void {
    this.#database.prepare('DELETE FROM product_aliases WHERE product_variant_id = ?').run(variantId);
    const statement = this.#database.prepare(`
      INSERT INTO product_aliases(id, product_variant_id, alias, normalized_alias, source, user_confirmed, created_at)
      VALUES (?, ?, ?, ?, 'manual', 1, ?)
    `);
    const seen = new Set<string>();
    for (const aliasValue of aliases) {
      const alias = aliasValue.trim();
      const normalized = normalizeAlias(alias);
      if (!alias || !normalized || seen.has(normalized)) continue;
      seen.add(normalized);
      statement.run(createId('alias'), variantId, alias, normalized, timestamp);
    }
  }

  private refreshSearchIndex(variantId: string): void {
    const product = this.#database.prepare(`
      SELECT product_variants.name, product_variants.brand, canonical_products.name AS canonicalName
      FROM product_variants
      JOIN canonical_products ON canonical_products.id = product_variants.canonical_product_id
      WHERE product_variants.id = ?
    `).get(variantId) as { name: string; brand: string | null; canonicalName: string } | undefined;
    if (!product) throw new Error('PRODUCT_VARIANT_NOT_FOUND');
    const aliases = (this.#database.prepare('SELECT alias FROM product_aliases WHERE product_variant_id = ?').all(variantId) as Array<{ alias: string }>).map((row) => row.alias);
    this.#database.prepare('DELETE FROM product_search WHERE entity_id = ?').run(variantId);
    this.#database.prepare('INSERT INTO product_search(entity_id, name, aliases) VALUES (?, ?, ?)').run(
      variantId,
      [product.brand, product.canonicalName, product.name].filter(Boolean).join(' '),
      aliases.join(' '),
    );
  }

  private resolveRetailer(name: string): string {
    const normalized = name.trim();
    if (!normalized) throw new RangeError('Retailer name is required');
    const existing = this.#database.prepare('SELECT id FROM retailers WHERE name = ? COLLATE NOCASE').get(normalized) as { id: string } | undefined;
    if (existing) return existing.id;
    const id = createId('retailer');
    this.#database.prepare('INSERT INTO retailers(id, name, created_at) VALUES (?, ?, ?)').run(id, normalized, this.#clock().toISOString());
    return id;
  }

  private storeById(id: string): StoreRecord | undefined {
    const row = this.#database.prepare(`
      SELECT
        stores.id,
        stores.retailer_id AS retailerId,
        retailers.name AS retailerName,
        stores.name,
        stores.region,
        stores.address,
        stores.latitude_microdegrees AS latitudeMicrodegrees,
        stores.longitude_microdegrees AS longitudeMicrodegrees,
        stores.osm_type AS osmType,
        stores.osm_id AS osmId,
        MAX(price_observations.observed_at) AS lastUsedAt
      FROM stores
      JOIN retailers ON retailers.id = stores.retailer_id
      LEFT JOIN price_observations ON price_observations.store_id = stores.id
      WHERE stores.id = ?
      GROUP BY stores.id, retailers.name
    `).get(id) as StoreRow | undefined;
    return row ? mapStore(row) : undefined;
  }
}
