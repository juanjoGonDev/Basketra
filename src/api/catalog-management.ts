import { DatabaseSync } from 'node:sqlite';
import { UNKNOWN_CATEGORY_COLOR } from '../domain/categories.ts';
import { asRecord, asSafeInteger, asString } from '../domain/validation.ts';
import { CategoryRepository } from '../infrastructure/category-repository.ts';
import { createId } from '../infrastructure/ids.ts';
import { ApiError } from './errors.ts';

const MAX_LATEST_PRICES_PER_PRODUCT = 12;

export type CatalogParentRecord = Readonly<{
  id: string;
  name: string;
  categoryId?: string;
  categoryName?: string;
  description?: string;
  variantCount: number;
}>;

export type CatalogRetailerNameRecord = Readonly<{
  listingId: string;
  retailerId: string;
  retailerName: string;
  title: string;
}>;

export type CatalogLatestPriceRecord = Readonly<{
  retailerId: string;
  retailerName: string;
  storeId?: string;
  storeName?: string;
  priceMinor: number;
  observedAt: string;
  confidence: number;
}>;

export type CatalogProductRecord = Readonly<{
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
  retailerNames: readonly CatalogRetailerNameRecord[];
  latestPrices: readonly CatalogLatestPriceRecord[];
  createdAt: string;
  updatedAt: string;
}>;

export type CatalogSnapshot = Readonly<{
  products: readonly CatalogProductRecord[];
  parents: readonly CatalogParentRecord[];
  offset: number;
  limit: number;
  hasMore: boolean;
}>;

type ProductRow = Readonly<{
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

type ParentRow = Readonly<{
  id: string;
  name: string;
  categoryId: string | null;
  categoryName: string | null;
  description: string | null;
  variantCount: number;
}>;

type LatestPriceRow = Readonly<{
  productVariantId: string;
  retailerId: string;
  retailerName: string;
  storeId: string | null;
  storeName: string | null;
  priceMinor: number;
  observedAt: string;
  confidence: number;
}>;

type CatalogApiContext = Readonly<{
  method?: string | undefined;
  pathname: string;
  searchParams: URLSearchParams;
  databasePath: string;
  readJson(): Promise<unknown>;
  send(status: number, body: unknown): void;
  publish(entityId: string, entityType?: 'product' | 'category'): void;
}>;

function normalizeText(value: string): string {
  return value.replace(/\s+/gu, ' ').trim();
}

function decodePathSegment(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    throw new ApiError(400, 'INVALID_PATH_PARAMETER', 'Path parameter is not valid URL encoding');
  }
}

function escapeLike(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_');
}

function withDatabase<T>(path: string, callback: (database: DatabaseSync) => T, readOnly = false): T {
  const database = new DatabaseSync(path, readOnly ? { readOnly: true } : {});
  try {
    return callback(database);
  } finally {
    database.close();
  }
}

function placeholders(count: number): string {
  return Array.from({ length: count }, () => '?').join(', ');
}

function loadAliases(database: DatabaseSync, productIds: readonly string[]): Map<string, string[]> {
  const result = new Map<string, string[]>();
  if (productIds.length === 0) return result;
  const rows = database.prepare(`
    SELECT product_variant_id AS productVariantId, alias
    FROM product_aliases
    WHERE product_variant_id IN (${placeholders(productIds.length)})
    ORDER BY created_at, id
  `).all(...productIds) as Array<{ productVariantId: string; alias: string }>;
  for (const row of rows) {
    const aliases = result.get(row.productVariantId) ?? [];
    aliases.push(row.alias);
    result.set(row.productVariantId, aliases);
  }
  return result;
}

function loadRetailerNames(database: DatabaseSync, productIds: readonly string[]): Map<string, CatalogRetailerNameRecord[]> {
  const result = new Map<string, CatalogRetailerNameRecord[]>();
  if (productIds.length === 0) return result;
  const rows = database.prepare(`
    SELECT
      retailer_listings.product_variant_id AS productVariantId,
      retailer_listings.id AS listingId,
      retailers.id AS retailerId,
      retailers.name AS retailerName,
      retailer_listings.title
    FROM retailer_listings
    JOIN retailers ON retailers.id = retailer_listings.retailer_id
    WHERE retailer_listings.product_variant_id IN (${placeholders(productIds.length)})
    ORDER BY retailers.name COLLATE NOCASE, retailer_listings.created_at, retailer_listings.id
  `).all(...productIds) as Array<{ productVariantId: string } & CatalogRetailerNameRecord>;
  for (const row of rows) {
    const names = result.get(row.productVariantId) ?? [];
    names.push({ listingId: row.listingId, retailerId: row.retailerId, retailerName: row.retailerName, title: row.title });
    result.set(row.productVariantId, names);
  }
  return result;
}

function loadLatestPrices(database: DatabaseSync, productIds: readonly string[]): Map<string, CatalogLatestPriceRecord[]> {
  const result = new Map<string, CatalogLatestPriceRecord[]>();
  if (productIds.length === 0) return result;
  const rows = database.prepare(`
    WITH latest_per_location AS (
      SELECT
        retailer_listings.product_variant_id AS productVariantId,
        retailers.id AS retailerId,
        retailers.name AS retailerName,
        stores.id AS storeId,
        stores.name AS storeName,
        price_observations.price_minor AS priceMinor,
        price_observations.observed_at AS observedAt,
        price_observations.confidence,
        ROW_NUMBER() OVER (
          PARTITION BY
            retailer_listings.product_variant_id,
            price_observations.retailer_id,
            COALESCE(price_observations.store_id, '')
          ORDER BY price_observations.observed_at DESC, price_observations.id DESC
        ) AS locationRank
      FROM price_observations
      JOIN retailer_listings ON retailer_listings.id = price_observations.retailer_listing_id
      JOIN retailers ON retailers.id = price_observations.retailer_id
      LEFT JOIN stores ON stores.id = price_observations.store_id
      WHERE retailer_listings.product_variant_id IN (${placeholders(productIds.length)})
    ), ranked AS (
      SELECT
        productVariantId,
        retailerId,
        retailerName,
        storeId,
        storeName,
        priceMinor,
        observedAt,
        confidence,
        ROW_NUMBER() OVER (
          PARTITION BY productVariantId
          ORDER BY observedAt DESC, retailerName COLLATE NOCASE, COALESCE(storeName, '') COLLATE NOCASE
        ) AS productRank
      FROM latest_per_location
      WHERE locationRank = 1
    )
    SELECT
      productVariantId,
      retailerId,
      retailerName,
      storeId,
      storeName,
      priceMinor,
      observedAt,
      confidence
    FROM ranked
    WHERE productRank <= ?
    ORDER BY productVariantId, productRank
  `).all(...productIds, MAX_LATEST_PRICES_PER_PRODUCT) as LatestPriceRow[];
  for (const row of rows) {
    const prices = result.get(row.productVariantId) ?? [];
    prices.push({
      retailerId: row.retailerId,
      retailerName: row.retailerName,
      ...(row.storeId ? { storeId: row.storeId } : {}),
      ...(row.storeName ? { storeName: row.storeName } : {}),
      priceMinor: row.priceMinor,
      observedAt: row.observedAt,
      confidence: row.confidence,
    });
    result.set(row.productVariantId, prices);
  }
  return result;
}

function mapProduct(
  row: ProductRow,
  aliases: Map<string, string[]>,
  retailerNames: Map<string, CatalogRetailerNameRecord[]>,
  latestPrices: Map<string, CatalogLatestPriceRecord[]>,
): CatalogProductRecord {
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
    aliases: aliases.get(row.id) ?? [],
    retailerNames: retailerNames.get(row.id) ?? [],
    latestPrices: latestPrices.get(row.id) ?? [],
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function listCatalog(databasePath: string, input: Readonly<{ query?: string; limit?: number; offset?: number }> = {}): CatalogSnapshot {
  const query = normalizeText(input.query ?? '');
  const limit = input.limit ?? 50;
  const offset = input.offset ?? 0;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new RangeError('Catalog limit must be between 1 and 100');
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > 10_000) throw new RangeError('Catalog offset is invalid');

  return withDatabase(databasePath, (database) => {
    const like = `%${escapeLike(query)}%`;
    const rows = database.prepare(`
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
      WHERE ? = ''
        OR canonical_products.name LIKE ? ESCAPE '\\' COLLATE NOCASE
        OR product_variants.name LIKE ? ESCAPE '\\' COLLATE NOCASE
        OR COALESCE(product_variants.brand, '') LIKE ? ESCAPE '\\' COLLATE NOCASE
        OR EXISTS (
          SELECT 1 FROM product_aliases
          WHERE product_aliases.product_variant_id = product_variants.id
            AND product_aliases.alias LIKE ? ESCAPE '\\' COLLATE NOCASE
        )
        OR EXISTS (
          SELECT 1
          FROM retailer_listings
          JOIN retailers ON retailers.id = retailer_listings.retailer_id
          WHERE retailer_listings.product_variant_id = product_variants.id
            AND (
              retailer_listings.title LIKE ? ESCAPE '\\' COLLATE NOCASE
              OR retailers.name LIKE ? ESCAPE '\\' COLLATE NOCASE
            )
        )
      ORDER BY canonical_products.name COLLATE NOCASE, product_variants.name COLLATE NOCASE, product_variants.id
      LIMIT ? OFFSET ?
    `).all(query, like, like, like, like, like, like, limit + 1, offset) as ProductRow[];
    const hasMore = rows.length > limit;
    const pageRows = rows.slice(0, limit);
    const productIds = pageRows.map((row) => row.id);
    const aliases = loadAliases(database, productIds);
    const retailerNames = loadRetailerNames(database, productIds);
    const latestPrices = loadLatestPrices(database, productIds);

    const parents = (database.prepare(`
      SELECT
        canonical_products.id,
        canonical_products.name,
        product_categories.id AS categoryId,
        product_categories.name AS categoryName,
        canonical_products.description,
        COUNT(product_variants.id) AS variantCount
      FROM canonical_products
      JOIN product_variants ON product_variants.canonical_product_id = canonical_products.id
      LEFT JOIN product_categories ON product_categories.id = canonical_products.category_id
      GROUP BY canonical_products.id, product_categories.id
      ORDER BY canonical_products.name COLLATE NOCASE, canonical_products.id
      LIMIT 500
    `).all() as ParentRow[]).map((row): CatalogParentRecord => ({
      id: row.id,
      name: row.name,
      ...(row.categoryId ? { categoryId: row.categoryId } : {}),
      ...(row.categoryName ? { categoryName: row.categoryName } : {}),
      ...(row.description ? { description: row.description } : {}),
      variantCount: Number(row.variantCount),
    }));

    return {
      products: pageRows.map((row) => mapProduct(row, aliases, retailerNames, latestPrices)),
      parents,
      offset,
      limit,
      hasMore,
    };
  }, true);
}

function refreshSearchIndex(database: DatabaseSync, variantId: string): void {
  const product = database.prepare(`
    SELECT product_variants.name, product_variants.brand, canonical_products.name AS canonicalName
    FROM product_variants
    JOIN canonical_products ON canonical_products.id = product_variants.canonical_product_id
    WHERE product_variants.id = ?
  `).get(variantId) as { name: string; brand: string | null; canonicalName: string } | undefined;
  if (!product) throw new ApiError(404, 'PRODUCT_VARIANT_NOT_FOUND', 'Product variant was not found');
  const aliases = (database.prepare('SELECT alias FROM product_aliases WHERE product_variant_id = ? ORDER BY created_at, id').all(variantId) as Array<{ alias: string }>).map((row) => row.alias);
  database.prepare('DELETE FROM product_search WHERE entity_id = ?').run(variantId);
  database.prepare('INSERT INTO product_search(entity_id, name, aliases) VALUES (?, ?, ?)').run(
    variantId,
    [product.brand, product.canonicalName, product.name].filter(Boolean).join(' '),
    aliases.join(' '),
  );
}

function assignExistingParent(databasePath: string, variantId: string, canonicalProductId: string): void {
  withDatabase(databasePath, (database) => {
    const variant = database.prepare('SELECT id FROM product_variants WHERE id = ?').get(variantId);
    if (!variant) throw new ApiError(404, 'PRODUCT_VARIANT_NOT_FOUND', 'Product variant was not found');
    const parent = database.prepare('SELECT id FROM canonical_products WHERE id = ?').get(canonicalProductId);
    if (!parent) throw new ApiError(404, 'CANONICAL_PRODUCT_NOT_FOUND', 'Canonical product was not found');
    const timestamp = new Date().toISOString();
    database.exec('BEGIN IMMEDIATE');
    try {
      database.prepare('UPDATE product_variants SET canonical_product_id = ?, updated_at = ? WHERE id = ?').run(canonicalProductId, timestamp, variantId);
      refreshSearchIndex(database, variantId);
      database.exec('COMMIT');
    } catch (error) {
      database.exec('ROLLBACK');
      throw error;
    }
  });
}

function createParentAndAssign(databasePath: string, variantId: string, name: string): string {
  return withDatabase(databasePath, (database) => {
    const current = database.prepare(`
      SELECT canonical_products.category, canonical_products.category_id AS categoryId, canonical_products.description
      FROM product_variants
      JOIN canonical_products ON canonical_products.id = product_variants.canonical_product_id
      WHERE product_variants.id = ?
    `).get(variantId) as { category: string | null; categoryId: string | null; description: string | null } | undefined;
    if (!current) throw new ApiError(404, 'PRODUCT_VARIANT_NOT_FOUND', 'Product variant was not found');
    const canonicalProductId = createId('product');
    const timestamp = new Date().toISOString();
    database.exec('BEGIN IMMEDIATE');
    try {
      database.prepare(`
        INSERT INTO canonical_products(id, name, category, category_id, description, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(canonicalProductId, name, current.category, current.categoryId, current.description, timestamp, timestamp);
      database.prepare('UPDATE product_variants SET canonical_product_id = ?, updated_at = ? WHERE id = ?').run(canonicalProductId, timestamp, variantId);
      refreshSearchIndex(database, variantId);
      database.exec('COMMIT');
      return canonicalProductId;
    } catch (error) {
      database.exec('ROLLBACK');
      throw error;
    }
  });
}

function upsertRetailerName(databasePath: string, variantId: string, retailerName: string, title: string): CatalogRetailerNameRecord {
  return withDatabase(databasePath, (database) => {
    const variant = database.prepare('SELECT id FROM product_variants WHERE id = ?').get(variantId);
    if (!variant) throw new ApiError(404, 'PRODUCT_VARIANT_NOT_FOUND', 'Product variant was not found');
    const timestamp = new Date().toISOString();
    database.exec('BEGIN IMMEDIATE');
    try {
      const existingRetailer = database.prepare('SELECT id, name FROM retailers WHERE name = ? COLLATE NOCASE').get(retailerName) as { id: string; name: string } | undefined;
      const retailerId = existingRetailer?.id ?? createId('retailer');
      const storedRetailerName = existingRetailer?.name ?? retailerName;
      if (!existingRetailer) database.prepare('INSERT INTO retailers(id, name, created_at) VALUES (?, ?, ?)').run(retailerId, retailerName, timestamp);

      const existingListing = database.prepare(`
        SELECT id FROM retailer_listings
        WHERE retailer_id = ? AND product_variant_id = ?
        ORDER BY created_at, id
        LIMIT 1
      `).get(retailerId, variantId) as { id: string } | undefined;
      const listingId = existingListing?.id ?? createId('listing');
      if (existingListing) {
        database.prepare('UPDATE retailer_listings SET title = ?, updated_at = ? WHERE id = ?').run(title, timestamp, listingId);
      } else {
        database.prepare(`
          INSERT INTO retailer_listings(id, retailer_id, product_variant_id, title, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(listingId, retailerId, variantId, title, timestamp, timestamp);
      }
      database.exec('COMMIT');
      return { listingId, retailerId, retailerName: storedRetailerName, title };
    } catch (error) {
      database.exec('ROLLBACK');
      throw error;
    }
  });
}

function parseNullableString(value: unknown, path: string, max: number): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  return asString(value, path, { min: 1, max });
}

function mapCategoryError(error: unknown): never {
  if (error instanceof ApiError) throw error;
  if (error instanceof RangeError) throw new ApiError(400, 'VALIDATION_ERROR', error.message);
  if (error instanceof Error) {
    if (error.message === 'PRODUCT_CATEGORY_PARENT_NOT_FOUND') {
      throw new ApiError(400, 'CATEGORY_PARENT_NOT_FOUND', 'Category parent was not found');
    }
    if (error.message === 'PRODUCT_CATEGORY_CYCLE') {
      throw new ApiError(409, 'CATEGORY_CYCLE', 'Category hierarchy cannot contain a cycle');
    }
    if (error.message === 'UNKNOWN_CATEGORY_PROTECTED') {
      throw new ApiError(409, 'UNKNOWN_CATEGORY_PROTECTED', 'The desconocido category must remain a root fallback category');
    }
  }
  throw error;
}

async function handleCategoryRequest(context: CatalogApiContext): Promise<boolean> {
  if (context.pathname === '/api/v1/categories' && context.method === 'GET') {
    const repository = new CategoryRepository(context.databasePath);
    repository.ensureUnknown();
    context.send(200, { categories: repository.list() });
    return true;
  }

  if (context.pathname === '/api/v1/categories' && context.method === 'POST') {
    const body = asRecord(await context.readJson());
    const repository = new CategoryRepository(context.databasePath);
    try {
      const category = repository.getOrCreate({
        name: asString(body['name'], '$.name', { min: 1, max: 120 }),
        parentId: parseNullableString(body['parentId'], '$.parentId', 128),
        color: body['color'] === undefined
          ? UNKNOWN_CATEGORY_COLOR
          : asString(body['color'], '$.color', { min: 7, max: 7 }),
        description: parseNullableString(body['description'], '$.description', 500),
      });
      context.publish(category.id, 'category');
      context.send(201, { category });
      return true;
    } catch (error) {
      mapCategoryError(error);
    }
  }

  const categoryMatch = /^\/api\/v1\/categories\/([^/]+)$/.exec(context.pathname);
  if (categoryMatch?.[1] && context.method === 'PATCH') {
    const categoryId = decodePathSegment(categoryMatch[1]);
    const body = asRecord(await context.readJson());
    const repository = new CategoryRepository(context.databasePath);
    try {
      const current = repository.get(categoryId);
      if (!current) throw new ApiError(404, 'CATEGORY_NOT_FOUND', 'Category was not found');
      const category = repository.update(categoryId, {
        name: body['name'] === undefined
          ? current.name
          : asString(body['name'], '$.name', { min: 1, max: 120 }),
        parentId: body['parentId'] === undefined
          ? current.parentId
          : parseNullableString(body['parentId'], '$.parentId', 128),
        color: body['color'] === undefined
          ? current.color
          : parseNullableString(body['color'], '$.color', 7),
        description: body['description'] === undefined
          ? current.description
          : parseNullableString(body['description'], '$.description', 500),
      });
      if (!category) throw new ApiError(404, 'CATEGORY_NOT_FOUND', 'Category was not found');
      context.publish(category.id, 'category');
      context.send(200, { category });
      return true;
    } catch (error) {
      mapCategoryError(error);
    }
  }

  return false;
}

export async function handleCatalogManagementRequest(context: CatalogApiContext): Promise<boolean> {
  if (await handleCategoryRequest(context)) return true;

  if (context.pathname === '/api/v1/catalog' && context.method === 'GET') {
    const query = normalizeText(context.searchParams.get('q') ?? '');
    if (query.length > 160) throw new ApiError(400, 'VALIDATION_ERROR', 'Catalog query is too long');
    const limit = Number(context.searchParams.get('limit') ?? 50);
    const offset = Number(context.searchParams.get('offset') ?? 0);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100 || !Number.isSafeInteger(offset) || offset < 0 || offset > 10_000) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Catalog pagination is invalid');
    }
    context.send(200, { catalog: listCatalog(context.databasePath, { query, limit, offset }) });
    return true;
  }

  const parentMatch = /^\/api\/v1\/catalog\/products\/([^/]+)\/parent$/.exec(context.pathname);
  if (parentMatch?.[1] && context.method === 'PUT') {
    const variantId = decodePathSegment(parentMatch[1]);
    const body = asRecord(await context.readJson());
    const existingParentId = body['canonicalProductId'] === undefined
      ? undefined
      : asString(body['canonicalProductId'], '$.canonicalProductId', { min: 1, max: 128 });
    const newParentName = body['newParentName'] === undefined
      ? undefined
      : normalizeText(asString(body['newParentName'], '$.newParentName', { min: 1, max: 160 }));
    if (Boolean(existingParentId) === Boolean(newParentName)) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Provide exactly one existing parent or new parent name');
    }
    const canonicalProductId = existingParentId ?? createParentAndAssign(context.databasePath, variantId, newParentName!);
    if (existingParentId) assignExistingParent(context.databasePath, variantId, existingParentId);
    context.publish(variantId);
    context.send(200, { relation: { productVariantId: variantId, canonicalProductId } });
    return true;
  }

  const retailerMatch = /^\/api\/v1\/catalog\/products\/([^/]+)\/retailer-name$/.exec(context.pathname);
  if (retailerMatch?.[1] && context.method === 'PUT') {
    const variantId = decodePathSegment(retailerMatch[1]);
    const body = asRecord(await context.readJson());
    const retailerName = normalizeText(asString(body['retailerName'], '$.retailerName', { min: 1, max: 160 }));
    const title = normalizeText(asString(body['title'], '$.title', { min: 1, max: 240 }));
    const retailerNameRecord = upsertRetailerName(context.databasePath, variantId, retailerName, title);
    context.publish(variantId);
    context.send(200, { retailerName: retailerNameRecord });
    return true;
  }

  return false;
}
