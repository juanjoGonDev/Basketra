import { DatabaseSync } from 'node:sqlite';
import { calculateReceiptLineDiscountMinor, calculateReceiptLineTotal, parseReceiptLineDiscount, type ReceiptLineDiscount } from '../domain/receipt.ts';
import { UNIT_VALUES } from '../domain/units.ts';
import { asArray, asEnum, asRecord, asSafeInteger, asString } from '../domain/validation.ts';
import { createId } from '../infrastructure/ids.ts';
import { ApiError } from './errors.ts';

const STORE_SORTS = ['name', 'recent', 'activity'] as const;
const PAYMENT_STATUSES = ['paid', 'pending', 'cancelled'] as const;
const STATISTIC_PERIODS = ['30d', '90d', 'year', 'all'] as const;
const DEFAULT_PAGE_SIZE = 12;
const MAX_PAGE_SIZE = 100;

type SqlValue = string | number | null;
type StoreSort = typeof STORE_SORTS[number];
type PaymentStatus = typeof PAYMENT_STATUSES[number];
type StatisticPeriod = typeof STATISTIC_PERIODS[number];

export type InventoryApiContext = Readonly<{
  method?: string | undefined;
  pathname: string;
  searchParams: URLSearchParams;
  databasePath: string;
  readJson(): Promise<unknown>;
  send(status: number, body: unknown): void;
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
  createdAt: string;
  productCount: number;
  ticketCount: number;
  priceObservationCount: number;
  lastActivityAt: string | null;
}>;

type ReceiptRow = Readonly<{
  id: string;
  retailerId: string | null;
  retailerName: string | null;
  storeId: string | null;
  storeName: string | null;
  declaredTotalMinor: number;
  purchasedAt: string | null;
  createdAt: string;
  updatedAt: string;
  paymentStatus: PaymentStatus;
  paymentMethod: string | null;
  notes: string | null;
  taxMinor: number;
  receiptDiscountMinor: number;
  itemCount: number;
}>;

type ReceiptItemRow = Readonly<{
  id: string;
  receiptId: string;
  originalDescription: string;
  normalizedDescription: string | null;
  productVariantId: string | null;
  categoryId: string | null;
  categoryName: string | null;
  quantity: number;
  unitPriceMinor: number;
  lineTotalMinor: number;
  discountMinor: number;
  unit: string;
  discountType: 'amount' | 'percentage';
  discountValue: number;
  discountQuantity: number;
  status: string;
  confidence: number;
}>;

type EditableReceiptLine = Readonly<{
  id?: string;
  description: string;
  categoryId?: string | null;
  quantity: number;
  unit: string;
  unitPriceMinor: number;
  discount?: ReceiptLineDiscount;
  lineTotalMinor: number;
  discountMinor: number;
}>;

function withDatabase<T>(path: string, callback: (database: DatabaseSync) => T, readOnly = false): T {
  const database = new DatabaseSync(path, readOnly ? { readOnly: true } : {});
  try {
    return callback(database);
  } finally {
    database.close();
  }
}

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

function parseIntegerParameter(value: string | null, fallback: number, path: string, min: number, max: number): number {
  const parsed = value === null ? fallback : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) throw new ApiError(400, 'VALIDATION_ERROR', `${path} is invalid`);
  return parsed;
}

function parseEnumParameter<T extends string>(value: string | null, fallback: T, allowed: readonly T[], path: string): T {
  if (value === null) return fallback;
  if (!allowed.includes(value as T)) throw new ApiError(400, 'VALIDATION_ERROR', `${path} is invalid`);
  return value as T;
}

function optionalString(value: unknown, path: string, max: number): string | null {
  if (value === undefined || value === null) return null;
  const normalized = asString(value, path, { max }).trim();
  return normalized || null;
}

function count(database: DatabaseSync, sql: string, ...params: SqlValue[]): number {
  const row = database.prepare(sql).get(...params) as { count: number };
  return Number(row.count);
}

function storeRecord(row: StoreRow): Readonly<Record<string, unknown>> {
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
    productCount: Number(row.productCount),
    ticketCount: Number(row.ticketCount),
    priceObservationCount: Number(row.priceObservationCount),
    ...(row.lastActivityAt ? { lastActivityAt: row.lastActivityAt } : {}),
    createdAt: row.createdAt,
  };
}

function storeSelectSql(whereSql = '', orderSql = 'stores.name COLLATE NOCASE, stores.id'): string {
  return `
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
      stores.created_at AS createdAt,
      COUNT(DISTINCT retailer_listings.product_variant_id) FILTER (WHERE price_observations.id IS NOT NULL) AS productCount,
      COUNT(DISTINCT receipts.id) AS ticketCount,
      COUNT(DISTINCT price_observations.id) AS priceObservationCount,
      MAX(COALESCE(price_observations.observed_at, receipts.purchased_at, receipts.created_at)) AS lastActivityAt
    FROM stores
    JOIN retailers ON retailers.id = stores.retailer_id
    LEFT JOIN price_observations ON price_observations.store_id = stores.id
    LEFT JOIN retailer_listings ON retailer_listings.id = price_observations.retailer_listing_id
    LEFT JOIN receipts ON receipts.store_id = stores.id
    ${whereSql}
    GROUP BY stores.id, retailers.name
    ORDER BY ${orderSql}
  `;
}

function storeOrder(sort: StoreSort): string {
  if (sort === 'recent') return 'stores.created_at DESC, stores.id';
  if (sort === 'activity') return '(lastActivityAt IS NULL), lastActivityAt DESC, stores.name COLLATE NOCASE, stores.id';
  return 'stores.name COLLATE NOCASE, stores.id';
}

function listStores(databasePath: string, params: URLSearchParams): Readonly<Record<string, unknown>> {
  const query = normalizeText(params.get('q') ?? '');
  if (query.length > 160) throw new ApiError(400, 'VALIDATION_ERROR', 'Store query is too long');
  const retailer = normalizeText(params.get('retailer') ?? '');
  if (retailer.length > 160) throw new ApiError(400, 'VALIDATION_ERROR', 'Retailer filter is too long');
  const sort = parseEnumParameter(params.get('sort'), 'name', STORE_SORTS, 'store sort');
  const limit = parseIntegerParameter(params.get('limit'), DEFAULT_PAGE_SIZE, 'store limit', 1, MAX_PAGE_SIZE);
  const offset = parseIntegerParameter(params.get('offset'), 0, 'store offset', 0, 10_000);
  return withDatabase(databasePath, (database) => {
    const conditions: string[] = [];
    const values: SqlValue[] = [];
    if (query) {
      conditions.push('(stores.name LIKE ? COLLATE NOCASE OR retailers.name LIKE ? COLLATE NOCASE OR COALESCE(stores.region, \'\') LIKE ? COLLATE NOCASE OR COALESCE(stores.address, \'\') LIKE ? COLLATE NOCASE)');
      const like = `%${query}%`;
      values.push(like, like, like, like);
    }
    if (retailer) {
      conditions.push('retailers.name = ? COLLATE NOCASE');
      values.push(retailer);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const total = count(database, `SELECT COUNT(*) AS count FROM stores JOIN retailers ON retailers.id = stores.retailer_id ${where}`, ...values);
    const rows = database.prepare(`${storeSelectSql(where, storeOrder(sort))} LIMIT ? OFFSET ?`).all(...values, limit, offset) as StoreRow[];
    return {
      stores: rows.map(storeRecord),
      total,
      limit,
      offset,
      hasMore: offset + rows.length < total,
    };
  }, true);
}

function getStore(databasePath: string, storeId: string): Readonly<Record<string, unknown>> {
  return withDatabase(databasePath, (database) => {
    const row = database.prepare(`${storeSelectSql('WHERE stores.id = ?')} LIMIT 1`).get(storeId) as StoreRow | undefined;
    if (!row) throw new ApiError(404, 'STORE_NOT_FOUND', 'Store was not found');
    return storeRecord(row);
  }, true);
}

function resolveRetailer(database: DatabaseSync, retailerName: string, timestamp: string): string {
  const existing = database.prepare('SELECT id FROM retailers WHERE name = ? COLLATE NOCASE').get(retailerName) as { id: string } | undefined;
  if (existing) return existing.id;
  const id = createId('retailer');
  database.prepare('INSERT INTO retailers(id, name, created_at) VALUES (?, ?, ?)').run(id, retailerName, timestamp);
  return id;
}

function parseStoreBody(body: unknown): Readonly<{
  retailerName: string;
  name: string;
  region: string | null;
  address: string | null;
  latitudeMicrodegrees: number | null;
  longitudeMicrodegrees: number | null;
  osmType: 'node' | 'way' | 'relation' | null;
  osmId: string | null;
}> {
  const candidate = asRecord(body);
  const hasLatitude = candidate['latitudeMicrodegrees'] !== undefined && candidate['latitudeMicrodegrees'] !== null;
  const hasLongitude = candidate['longitudeMicrodegrees'] !== undefined && candidate['longitudeMicrodegrees'] !== null;
  if (hasLatitude !== hasLongitude) throw new ApiError(400, 'VALIDATION_ERROR', 'Both store coordinates are required');
  const hasOsmType = candidate['osmType'] !== undefined && candidate['osmType'] !== null && candidate['osmType'] !== '';
  const hasOsmId = candidate['osmId'] !== undefined && candidate['osmId'] !== null && candidate['osmId'] !== '';
  if (hasOsmType !== hasOsmId) throw new ApiError(400, 'VALIDATION_ERROR', 'Both OSM identity fields are required');
  return {
    retailerName: normalizeText(asString(candidate['retailerName'], '$.retailerName', { min: 1, max: 160 })),
    name: normalizeText(asString(candidate['name'], '$.name', { min: 1, max: 160 })),
    region: optionalString(candidate['region'], '$.region', 160),
    address: optionalString(candidate['address'], '$.address', 240),
    latitudeMicrodegrees: hasLatitude ? asSafeInteger(candidate['latitudeMicrodegrees'], '$.latitudeMicrodegrees', { min: -90_000_000, max: 90_000_000 }) : null,
    longitudeMicrodegrees: hasLongitude ? asSafeInteger(candidate['longitudeMicrodegrees'], '$.longitudeMicrodegrees', { min: -180_000_000, max: 180_000_000 }) : null,
    osmType: hasOsmType ? asEnum(candidate['osmType'], '$.osmType', ['node', 'way', 'relation'] as const) : null,
    osmId: hasOsmId ? asString(candidate['osmId'], '$.osmId', { min: 1, max: 40 }) : null,
  };
}

function createStore(databasePath: string, body: unknown): Readonly<Record<string, unknown>> {
  const input = parseStoreBody(body);
  return withDatabase(databasePath, (database) => {
    const timestamp = new Date().toISOString();
    database.exec('BEGIN IMMEDIATE');
    try {
      if (input.osmType && input.osmId) {
        const duplicate = database.prepare('SELECT id FROM stores WHERE osm_type = ? AND osm_id = ?').get(input.osmType, input.osmId);
        if (duplicate) throw new ApiError(409, 'STORE_OSM_IDENTITY_EXISTS', 'A store with this OpenStreetMap identity already exists');
      }
      const retailerId = resolveRetailer(database, input.retailerName, timestamp);
      const id = createId('store');
      database.prepare(`
        INSERT INTO stores(id, retailer_id, name, region, address, latitude_microdegrees, longitude_microdegrees, osm_type, osm_id, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, retailerId, input.name, input.region, input.address, input.latitudeMicrodegrees, input.longitudeMicrodegrees, input.osmType, input.osmId, timestamp);
      database.exec('COMMIT');
      return getStore(databasePath, id);
    } catch (error) {
      database.exec('ROLLBACK');
      throw error;
    }
  });
}

function updateStore(databasePath: string, storeId: string, body: unknown): Readonly<Record<string, unknown>> {
  const input = parseStoreBody(body);
  return withDatabase(databasePath, (database) => {
    const exists = database.prepare('SELECT id FROM stores WHERE id = ?').get(storeId);
    if (!exists) throw new ApiError(404, 'STORE_NOT_FOUND', 'Store was not found');
    const timestamp = new Date().toISOString();
    database.exec('BEGIN IMMEDIATE');
    try {
      if (input.osmType && input.osmId) {
        const duplicate = database.prepare('SELECT id FROM stores WHERE osm_type = ? AND osm_id = ? AND id <> ?').get(input.osmType, input.osmId, storeId);
        if (duplicate) throw new ApiError(409, 'STORE_OSM_IDENTITY_EXISTS', 'A store with this OpenStreetMap identity already exists');
      }
      const retailerId = resolveRetailer(database, input.retailerName, timestamp);
      database.prepare(`
        UPDATE stores SET retailer_id = ?, name = ?, region = ?, address = ?, latitude_microdegrees = ?, longitude_microdegrees = ?, osm_type = ?, osm_id = ?
        WHERE id = ?
      `).run(retailerId, input.name, input.region, input.address, input.latitudeMicrodegrees, input.longitudeMicrodegrees, input.osmType, input.osmId, storeId);
      database.exec('COMMIT');
      return getStore(databasePath, storeId);
    } catch (error) {
      database.exec('ROLLBACK');
      throw error;
    }
  });
}

function storeDeleteImpact(databasePath: string, storeId: string): Readonly<Record<string, unknown>> {
  return withDatabase(databasePath, (database) => {
    const exists = database.prepare('SELECT id FROM stores WHERE id = ?').get(storeId);
    if (!exists) throw new ApiError(404, 'STORE_NOT_FOUND', 'Store was not found');
    const priceObservations = count(database, 'SELECT COUNT(*) AS count FROM price_observations WHERE store_id = ?', storeId);
    const linkedProducts = count(database, `
      SELECT COUNT(DISTINCT retailer_listings.product_variant_id) AS count
      FROM price_observations
      JOIN retailer_listings ON retailer_listings.id = price_observations.retailer_listing_id
      WHERE price_observations.store_id = ? AND retailer_listings.product_variant_id IS NOT NULL
    `, storeId);
    const historicalTickets = count(database, 'SELECT COUNT(*) AS count FROM receipts WHERE store_id = ?', storeId);
    return {
      linkedProducts,
      priceObservations,
      historicalTickets,
      canDelete: priceObservations === 0 && historicalTickets === 0,
    };
  }, true);
}

function deleteStore(databasePath: string, storeId: string): void {
  withDatabase(databasePath, (database) => {
    database.exec('BEGIN IMMEDIATE');
    try {
      const exists = database.prepare('SELECT id FROM stores WHERE id = ?').get(storeId);
      if (!exists) throw new ApiError(404, 'STORE_NOT_FOUND', 'Store was not found');
      const priceObservations = count(database, 'SELECT COUNT(*) AS count FROM price_observations WHERE store_id = ?', storeId);
      const historicalTickets = count(database, 'SELECT COUNT(*) AS count FROM receipts WHERE store_id = ?', storeId);
      if (priceObservations > 0 || historicalTickets > 0) throw new ApiError(409, 'STORE_DELETE_BLOCKED', 'Store has historical price or ticket dependencies');
      database.prepare('DELETE FROM stores WHERE id = ?').run(storeId);
      database.exec('COMMIT');
    } catch (error) {
      database.exec('ROLLBACK');
      throw error;
    }
  });
}

function periodStart(period: StatisticPeriod): string | null {
  if (period === 'all') return null;
  const now = new Date();
  if (period === '30d') now.setUTCDate(now.getUTCDate() - 30);
  else if (period === '90d') now.setUTCDate(now.getUTCDate() - 90);
  else now.setUTCFullYear(now.getUTCFullYear() - 1);
  return now.toISOString();
}

function inventoryStatistics(databasePath: string, params: URLSearchParams): Readonly<Record<string, unknown>> {
  const period = parseEnumParameter(params.get('period'), '30d', STATISTIC_PERIODS, 'statistics period');
  const start = periodStart(period);
  return withDatabase(databasePath, (database) => {
    const receiptPredicate = start ? 'AND COALESCE(receipts.purchased_at, receipts.created_at) >= ?' : '';
    const periodParams: SqlValue[] = start ? [start] : [];
    const activeProducts = count(database, 'SELECT COUNT(*) AS count FROM product_variants');
    const uncategorizedProducts = count(database, 'SELECT COUNT(*) AS count FROM canonical_products WHERE category_id IS NULL OR category_id = \'category_unknown\'');
    const latestCatalogValueRow = database.prepare(`
      WITH latest AS (
        SELECT retailer_listings.product_variant_id AS productVariantId, price_observations.price_minor AS priceMinor,
          ROW_NUMBER() OVER (PARTITION BY retailer_listings.product_variant_id ORDER BY price_observations.observed_at DESC, price_observations.id DESC) AS rank
        FROM price_observations
        JOIN retailer_listings ON retailer_listings.id = price_observations.retailer_listing_id
        WHERE retailer_listings.product_variant_id IS NOT NULL
      ) SELECT COALESCE(SUM(priceMinor), 0) AS value FROM latest WHERE rank = 1
    `).get() as { value: number };
    const ticketSummary = database.prepare(`
      SELECT COUNT(*) AS tickets, COALESCE(SUM(receipts.declared_total_minor), 0) AS spent
      FROM receipts
      WHERE receipts.payment_status <> 'cancelled' ${receiptPredicate}
    `).get(...periodParams) as { tickets: number; spent: number };
    const entriesValue = database.prepare(`
      SELECT COALESCE(SUM(receipt_items.line_total_minor), 0) AS value
      FROM receipt_items
      JOIN receipts ON receipts.id = receipt_items.receipt_id
      WHERE receipt_items.status <> 'deleted' ${receiptPredicate}
    `).get(...periodParams) as { value: number };
    const categoryStats = database.prepare(`
      SELECT product_categories.id, product_categories.name,
        COUNT(DISTINCT canonical_products.id) AS productCount,
        COUNT(DISTINCT receipts.id) AS ticketCount,
        COALESCE(SUM(receipt_items.line_total_minor), 0) AS spentMinor
      FROM product_categories
      LEFT JOIN canonical_products ON canonical_products.category_id = product_categories.id
      LEFT JOIN product_variants ON product_variants.canonical_product_id = canonical_products.id
      LEFT JOIN receipt_items ON receipt_items.product_variant_id = product_variants.id OR receipt_items.category_id = product_categories.id
      LEFT JOIN receipts ON receipts.id = receipt_items.receipt_id ${start ? 'AND COALESCE(receipts.purchased_at, receipts.created_at) >= ?' : ''}
      GROUP BY product_categories.id
      ORDER BY spentMinor DESC, product_categories.name COLLATE NOCASE
      LIMIT 20
    `).all(...periodParams) as Array<{ id: string; name: string; productCount: number; ticketCount: number; spentMinor: number }>;
    const storeStats = database.prepare(`
      SELECT stores.id, stores.name, retailers.name AS retailerName,
        COUNT(DISTINCT receipts.id) AS ticketCount,
        COUNT(DISTINCT retailer_listings.product_variant_id) AS productCount,
        COALESCE(SUM(CASE WHEN receipts.payment_status <> 'cancelled' THEN receipts.declared_total_minor ELSE 0 END), 0) AS spentMinor
      FROM stores
      JOIN retailers ON retailers.id = stores.retailer_id
      LEFT JOIN receipts ON receipts.store_id = stores.id ${start ? 'AND COALESCE(receipts.purchased_at, receipts.created_at) >= ?' : ''}
      LEFT JOIN price_observations ON price_observations.store_id = stores.id
      LEFT JOIN retailer_listings ON retailer_listings.id = price_observations.retailer_listing_id
      GROUP BY stores.id, retailers.name
      ORDER BY ticketCount DESC, productCount DESC, stores.name COLLATE NOCASE
      LIMIT 20
    `).all(...periodParams) as Array<{ id: string; name: string; retailerName: string; ticketCount: number; productCount: number; spentMinor: number }>;
    const ticketTrend = database.prepare(`
      SELECT substr(COALESCE(receipts.purchased_at, receipts.created_at), 1, 10) AS date,
        COUNT(*) AS ticketCount,
        COALESCE(SUM(CASE WHEN receipts.payment_status <> 'cancelled' THEN receipts.declared_total_minor ELSE 0 END), 0) AS spentMinor
      FROM receipts
      WHERE 1 = 1 ${receiptPredicate}
      GROUP BY date
      ORDER BY date
    `).all(...periodParams) as Array<{ date: string; ticketCount: number; spentMinor: number }>;
    return {
      period,
      summary: {
        latestCatalogValueMinor: Number(latestCatalogValueRow.value),
        activeProducts,
        ticketsProcessed: Number(ticketSummary.tickets),
        totalSpentMinor: Number(ticketSummary.spent),
        entriesValueMinor: Number(entriesValue.value),
        uncategorizedProducts,
        lowStockProducts: null,
        lowStockUnavailableReason: 'Stock thresholds are not part of the current canonical inventory model.',
      },
      categoryStats: categoryStats.map(row => ({ ...row, productCount: Number(row.productCount), ticketCount: Number(row.ticketCount), spentMinor: Number(row.spentMinor) })),
      storeStats: storeStats.map(row => ({ ...row, ticketCount: Number(row.ticketCount), productCount: Number(row.productCount), spentMinor: Number(row.spentMinor) })),
      ticketTrend: ticketTrend.map(row => ({ ...row, ticketCount: Number(row.ticketCount), spentMinor: Number(row.spentMinor) })),
    };
  }, true);
}

function receiptWhere(params: URLSearchParams): Readonly<{ sql: string; values: readonly SqlValue[] }> {
  const conditions: string[] = [];
  const values: SqlValue[] = [];
  const query = normalizeText(params.get('q') ?? '');
  if (query.length > 160) throw new ApiError(400, 'VALIDATION_ERROR', 'Ticket query is too long');
  if (query) {
    const like = `%${query}%`;
    conditions.push('(COALESCE(stores.name, retailers.name, \'\') LIKE ? COLLATE NOCASE OR COALESCE(receipts.notes, \'\') LIKE ? COLLATE NOCASE OR receipts.id LIKE ? COLLATE NOCASE)');
    values.push(like, like, like);
    const amount = Number(query.replace(',', '.'));
    if (Number.isFinite(amount) && amount >= 0) {
      conditions.push('(1 = 1 OR receipts.declared_total_minor = ?)');
      values.push(Math.round(amount * 100));
    }
  }
  const dateFrom = params.get('dateFrom');
  if (dateFrom) {
    if (Number.isNaN(Date.parse(dateFrom))) throw new ApiError(400, 'VALIDATION_ERROR', 'dateFrom is invalid');
    conditions.push('COALESCE(receipts.purchased_at, receipts.created_at) >= ?');
    values.push(dateFrom);
  }
  const dateTo = params.get('dateTo');
  if (dateTo) {
    if (Number.isNaN(Date.parse(dateTo))) throw new ApiError(400, 'VALIDATION_ERROR', 'dateTo is invalid');
    conditions.push('COALESCE(receipts.purchased_at, receipts.created_at) <= ?');
    values.push(dateTo);
  }
  const storeId = normalizeText(params.get('storeId') ?? '');
  if (storeId) {
    conditions.push('receipts.store_id = ?');
    values.push(storeId);
  }
  const categoryId = normalizeText(params.get('categoryId') ?? '');
  if (categoryId) {
    conditions.push('EXISTS (SELECT 1 FROM receipt_items WHERE receipt_items.receipt_id = receipts.id AND receipt_items.category_id = ?)');
    values.push(categoryId);
  }
  const paymentStatus = params.get('paymentStatus');
  if (paymentStatus) {
    if (!PAYMENT_STATUSES.includes(paymentStatus as PaymentStatus)) throw new ApiError(400, 'VALIDATION_ERROR', 'paymentStatus is invalid');
    conditions.push('receipts.payment_status = ?');
    values.push(paymentStatus);
  }
  return { sql: conditions.length ? `WHERE ${conditions.join(' AND ')}` : '', values };
}

function receiptSelect(whereSql = '', orderSql = 'COALESCE(receipts.purchased_at, receipts.created_at) DESC, receipts.id DESC'): string {
  return `
    SELECT receipts.id, receipts.retailer_id AS retailerId, retailers.name AS retailerName,
      receipts.store_id AS storeId, stores.name AS storeName,
      receipts.declared_total_minor AS declaredTotalMinor, receipts.purchased_at AS purchasedAt,
      receipts.created_at AS createdAt, receipts.updated_at AS updatedAt,
      receipts.payment_status AS paymentStatus, receipts.payment_method AS paymentMethod,
      receipts.notes, receipts.tax_minor AS taxMinor, receipts.receipt_discount_minor AS receiptDiscountMinor,
      COUNT(receipt_items.id) FILTER (WHERE receipt_items.status <> 'deleted') AS itemCount
    FROM receipts
    LEFT JOIN retailers ON retailers.id = receipts.retailer_id
    LEFT JOIN stores ON stores.id = receipts.store_id
    LEFT JOIN receipt_items ON receipt_items.receipt_id = receipts.id
    ${whereSql}
    GROUP BY receipts.id, retailers.name, stores.name
    ORDER BY ${orderSql}
  `;
}

function receiptRecord(row: ReceiptRow): Readonly<Record<string, unknown>> {
  return {
    id: row.id,
    ...(row.retailerId ? { retailerId: row.retailerId } : {}),
    ...(row.retailerName ? { retailerName: row.retailerName } : {}),
    ...(row.storeId ? { storeId: row.storeId } : {}),
    ...(row.storeName ? { storeName: row.storeName } : {}),
    declaredTotalMinor: Number(row.declaredTotalMinor),
    purchasedAt: row.purchasedAt ?? row.createdAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    paymentStatus: row.paymentStatus,
    ...(row.paymentMethod ? { paymentMethod: row.paymentMethod } : {}),
    ...(row.notes ? { notes: row.notes } : {}),
    taxMinor: Number(row.taxMinor),
    receiptDiscountMinor: Number(row.receiptDiscountMinor),
    itemCount: Number(row.itemCount),
  };
}

function listReceipts(databasePath: string, params: URLSearchParams): Readonly<Record<string, unknown>> {
  const limit = parseIntegerParameter(params.get('limit'), DEFAULT_PAGE_SIZE, 'ticket limit', 1, MAX_PAGE_SIZE);
  const offset = parseIntegerParameter(params.get('offset'), 0, 'ticket offset', 0, 10_000);
  const where = receiptWhere(params);
  return withDatabase(databasePath, (database) => {
    const total = count(database, `SELECT COUNT(*) AS count FROM receipts LEFT JOIN retailers ON retailers.id = receipts.retailer_id LEFT JOIN stores ON stores.id = receipts.store_id ${where.sql}`, ...where.values);
    const rows = database.prepare(`${receiptSelect(where.sql)} LIMIT ? OFFSET ?`).all(...where.values, limit, offset) as ReceiptRow[];
    const summary = database.prepare(`
      SELECT COUNT(*) AS ticketCount,
        COALESCE(SUM(receipts.declared_total_minor), 0) AS totalSpentMinor,
        COALESCE(SUM((SELECT COUNT(*) FROM receipt_items WHERE receipt_items.receipt_id = receipts.id AND receipt_items.status <> 'deleted')), 0) AS itemCount
      FROM receipts
      LEFT JOIN retailers ON retailers.id = receipts.retailer_id
      LEFT JOIN stores ON stores.id = receipts.store_id
      ${where.sql}
    `).get(...where.values) as { ticketCount: number; totalSpentMinor: number; itemCount: number };
    const ticketCount = Number(summary.ticketCount);
    const totalSpentMinor = Number(summary.totalSpentMinor);
    return {
      tickets: rows.map(receiptRecord),
      total,
      limit,
      offset,
      hasMore: offset + rows.length < total,
      summary: {
        ticketCount,
        totalSpentMinor,
        itemCount: Number(summary.itemCount),
        averageTicketMinor: ticketCount === 0 ? 0 : Math.round(totalSpentMinor / ticketCount),
      },
    };
  }, true);
}

function getReceiptItems(database: DatabaseSync, receiptId: string): ReceiptItemRow[] {
  return database.prepare(`
    SELECT receipt_items.id, receipt_items.receipt_id AS receiptId,
      receipt_items.original_description AS originalDescription,
      receipt_items.normalized_description AS normalizedDescription,
      receipt_items.product_variant_id AS productVariantId,
      receipt_items.category_id AS categoryId, product_categories.name AS categoryName,
      receipt_items.quantity, receipt_items.unit_price_minor AS unitPriceMinor,
      receipt_items.line_total_minor AS lineTotalMinor, receipt_items.discount_minor AS discountMinor,
      receipt_items.unit, receipt_items.discount_type AS discountType,
      receipt_items.discount_value AS discountValue, receipt_items.discount_quantity AS discountQuantity,
      receipt_items.status, receipt_items.confidence
    FROM receipt_items
    LEFT JOIN product_categories ON product_categories.id = receipt_items.category_id
    WHERE receipt_items.receipt_id = ? AND receipt_items.status <> 'deleted'
    ORDER BY receipt_items.created_at, receipt_items.id
  `).all(receiptId) as ReceiptItemRow[];
}

function receiptItemRecord(row: ReceiptItemRow): Readonly<Record<string, unknown>> {
  const discount = row.discountType === 'percentage'
    ? { type: 'percentage', basisPoints: Number(row.discountValue), quantity: Number(row.discountQuantity) }
    : { type: 'amount', amountMinor: Number(row.discountValue), quantity: Number(row.discountQuantity) };
  return {
    id: row.id,
    originalDescription: row.originalDescription,
    description: row.normalizedDescription ?? row.originalDescription,
    ...(row.productVariantId ? { productVariantId: row.productVariantId } : {}),
    ...(row.categoryId ? { categoryId: row.categoryId } : {}),
    ...(row.categoryName ? { categoryName: row.categoryName } : {}),
    quantity: Number(row.quantity),
    unit: row.unit,
    unitPriceMinor: Number(row.unitPriceMinor),
    discount,
    lineTotalMinor: Number(row.lineTotalMinor),
    status: row.status,
    confidence: Number(row.confidence),
  };
}

function getReceipt(databasePath: string, receiptId: string): Readonly<Record<string, unknown>> {
  return withDatabase(databasePath, (database) => {
    const row = database.prepare(`${receiptSelect('WHERE receipts.id = ?')} LIMIT 1`).get(receiptId) as ReceiptRow | undefined;
    if (!row) throw new ApiError(404, 'RECEIPT_NOT_FOUND', 'Ticket was not found');
    return { ...receiptRecord(row), items: getReceiptItems(database, receiptId).map(receiptItemRecord) };
  }, true);
}

function parseEditableLine(value: unknown, index: number): EditableReceiptLine {
  const candidate = asRecord(value);
  const quantity = asSafeInteger(candidate['quantity'], `$.items[${index}].quantity`, { min: 1, max: 100_000 });
  const unitPriceMinor = asSafeInteger(candidate['unitPriceMinor'], `$.items[${index}].unitPriceMinor`, { min: 0, max: 100_000_000 });
  const discount = candidate['discount'] === undefined || candidate['discount'] === null
    ? undefined
    : parseReceiptLineDiscount(candidate['discount'], `$.items[${index}].discount`);
  const lineTotalMinor = calculateReceiptLineTotal({ quantity, unitPriceMinor, ...(discount ? { discount } : {}) });
  const discountMinor = calculateReceiptLineDiscountMinor({ quantity, unitPriceMinor, ...(discount ? { discount } : {}) });
  return {
    ...(candidate['id'] === undefined ? {} : { id: asString(candidate['id'], `$.items[${index}].id`, { min: 1, max: 128 }) }),
    description: normalizeText(asString(candidate['description'], `$.items[${index}].description`, { min: 1, max: 240 })),
    categoryId: candidate['categoryId'] === undefined || candidate['categoryId'] === null || candidate['categoryId'] === ''
      ? null
      : asString(candidate['categoryId'], `$.items[${index}].categoryId`, { min: 1, max: 128 }),
    quantity,
    unit: asEnum(candidate['unit'] ?? 'unit', `$.items[${index}].unit`, UNIT_VALUES),
    unitPriceMinor,
    ...(discount ? { discount } : {}),
    lineTotalMinor,
    discountMinor,
  };
}

function correction(database: DatabaseSync, itemId: string, field: string, original: unknown, corrected: unknown, timestamp: string): void {
  if (JSON.stringify(original) === JSON.stringify(corrected)) return;
  database.prepare(`
    INSERT INTO receipt_corrections(id, receipt_item_id, field, original_json, corrected_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(createId('receipt_correction'), itemId, field, JSON.stringify(original), JSON.stringify(corrected), timestamp);
}

function ensureCategory(database: DatabaseSync, categoryId: string | null | undefined): void {
  if (!categoryId) return;
  if (!database.prepare('SELECT id FROM product_categories WHERE id = ?').get(categoryId)) throw new ApiError(400, 'CATEGORY_NOT_FOUND', 'Ticket line category was not found');
}

function syncReceiptPriceObservation(database: DatabaseSync, itemId: string, retailerId: string | null, storeId: string | null, observedAt: string): void {
  const evidence = database.prepare(`
    SELECT id FROM external_evidence WHERE source_type = 'receipt' AND source_reference = ?
  `).get(`receipt-item:${itemId}`) as { id: string } | undefined;
  if (!evidence) return;
  const item = database.prepare('SELECT product_variant_id AS productVariantId, unit_price_minor AS unitPriceMinor FROM receipt_items WHERE id = ?').get(itemId) as { productVariantId: string | null; unitPriceMinor: number } | undefined;
  if (!item) return;
  const observation = database.prepare('SELECT id FROM price_observations WHERE evidence_id = ?').get(evidence.id) as { id: string } | undefined;
  if (!retailerId || !item.productVariantId) {
    if (observation) database.prepare('DELETE FROM price_observations WHERE id = ?').run(observation.id);
    return;
  }
  let listing = database.prepare(`
    SELECT id FROM retailer_listings WHERE retailer_id = ? AND product_variant_id = ? ORDER BY created_at, id LIMIT 1
  `).get(retailerId, item.productVariantId) as { id: string } | undefined;
  if (!listing) {
    const titleRow = database.prepare('SELECT normalized_description AS normalizedDescription, original_description AS originalDescription FROM receipt_items WHERE id = ?').get(itemId) as { normalizedDescription: string | null; originalDescription: string };
    const listingId = createId('listing');
    const timestamp = new Date().toISOString();
    database.prepare(`INSERT INTO retailer_listings(id, retailer_id, product_variant_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(listingId, retailerId, item.productVariantId, titleRow.normalizedDescription ?? titleRow.originalDescription, timestamp, timestamp);
    listing = { id: listingId };
  }
  if (observation) {
    database.prepare(`
      UPDATE price_observations
      SET retailer_listing_id = ?, retailer_id = ?, store_id = ?, price_minor = ?, normalized_price_numerator = ?, normalized_price_denominator = 1, observed_at = ?
      WHERE id = ?
    `).run(listing.id, retailerId, storeId, item.unitPriceMinor, item.unitPriceMinor, observedAt, observation.id);
  }
}

function updateReceipt(databasePath: string, receiptId: string, body: unknown): Readonly<Record<string, unknown>> {
  const candidate = asRecord(body);
  const items = asArray(candidate['items'], '$.items', 500).map((value, index) => parseEditableLine(value, index));
  const purchasedAt = asString(candidate['purchasedAt'], '$.purchasedAt', { min: 10, max: 40 });
  if (Number.isNaN(Date.parse(purchasedAt))) throw new ApiError(400, 'VALIDATION_ERROR', 'Ticket date is invalid');
  const storeId = candidate['storeId'] === undefined || candidate['storeId'] === null || candidate['storeId'] === ''
    ? null
    : asString(candidate['storeId'], '$.storeId', { min: 1, max: 128 });
  const paymentStatus = asEnum(candidate['paymentStatus'] ?? 'paid', '$.paymentStatus', PAYMENT_STATUSES);
  const paymentMethod = optionalString(candidate['paymentMethod'], '$.paymentMethod', 80);
  const notes = optionalString(candidate['notes'], '$.notes', 2000);
  const taxMinor = asSafeInteger(candidate['taxMinor'] ?? 0, '$.taxMinor', { min: 0, max: 100_000_000 });
  const receiptDiscountMinor = asSafeInteger(candidate['receiptDiscountMinor'] ?? 0, '$.receiptDiscountMinor', { min: 0, max: 100_000_000 });
  let linesMinor = 0;
  for (const item of items) {
    linesMinor += item.lineTotalMinor;
    if (!Number.isSafeInteger(linesMinor)) throw new ApiError(400, 'VALIDATION_ERROR', 'Ticket total exceeds the safe integer range');
  }
  const beforeDiscount = linesMinor + taxMinor;
  if (!Number.isSafeInteger(beforeDiscount) || receiptDiscountMinor > beforeDiscount) throw new ApiError(400, 'VALIDATION_ERROR', 'Ticket discount exceeds the subtotal and taxes');
  const declaredTotalMinor = beforeDiscount - receiptDiscountMinor;
  return withDatabase(databasePath, (database) => {
    const receipt = database.prepare('SELECT id, retailer_id AS retailerId FROM receipts WHERE id = ?').get(receiptId) as { id: string; retailerId: string | null } | undefined;
    if (!receipt) throw new ApiError(404, 'RECEIPT_NOT_FOUND', 'Ticket was not found');
    let retailerId = receipt.retailerId;
    if (storeId) {
      const store = database.prepare('SELECT retailer_id AS retailerId FROM stores WHERE id = ?').get(storeId) as { retailerId: string } | undefined;
      if (!store) throw new ApiError(400, 'STORE_NOT_FOUND', 'Selected ticket store was not found');
      retailerId = store.retailerId;
    }
    const timestamp = new Date().toISOString();
    database.exec('BEGIN IMMEDIATE');
    try {
      const existing = getReceiptItems(database, receiptId);
      const existingById = new Map(existing.map(item => [item.id, item]));
      const keptIds = new Set<string>();
      for (const line of items) {
        ensureCategory(database, line.categoryId);
        if (line.id) {
          const current = existingById.get(line.id);
          if (!current) throw new ApiError(409, 'RECEIPT_ITEM_NOT_FOUND', 'A ticket line no longer exists');
          keptIds.add(line.id);
          correction(database, line.id, 'description', current.normalizedDescription ?? current.originalDescription, line.description, timestamp);
          correction(database, line.id, 'quantity', current.quantity, line.quantity, timestamp);
          correction(database, line.id, 'unitPriceMinor', current.unitPriceMinor, line.unitPriceMinor, timestamp);
          correction(database, line.id, 'categoryId', current.categoryId, line.categoryId ?? null, timestamp);
          correction(database, line.id, 'unit', current.unit, line.unit, timestamp);
          correction(database, line.id, 'discount', { type: current.discountType, value: current.discountValue, quantity: current.discountQuantity }, line.discount ?? null, timestamp);
          const discountType = line.discount?.type ?? 'amount';
          const discountValue = line.discount?.type === 'percentage' ? line.discount.basisPoints : line.discount?.amountMinor ?? 0;
          const discountQuantity = line.discount?.quantity ?? line.quantity;
          database.prepare(`
            UPDATE receipt_items SET normalized_description = ?, quantity = ?, unit_price_minor = ?, line_total_minor = ?, discount_minor = ?, category_id = ?, unit = ?, discount_type = ?, discount_value = ?, discount_quantity = ?, status = 'confirmed', confidence = 1
            WHERE id = ? AND receipt_id = ?
          `).run(line.description, line.quantity, line.unitPriceMinor, line.lineTotalMinor, line.discountMinor, line.categoryId ?? null, line.unit, discountType, discountValue, discountQuantity, line.id, receiptId);
        } else {
          const id = createId('receipt_item');
          keptIds.add(id);
          const discountType = line.discount?.type ?? 'amount';
          const discountValue = line.discount?.type === 'percentage' ? line.discount.basisPoints : line.discount?.amountMinor ?? 0;
          const discountQuantity = line.discount?.quantity ?? line.quantity;
          database.prepare(`
            INSERT INTO receipt_items(id, receipt_id, original_description, normalized_description, product_variant_id, quantity, unit_price_minor, line_total_minor, discount_minor, status, confidence, match_reason, created_at, category_id, unit, discount_type, discount_value, discount_quantity)
            VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, 'confirmed', 1, 'manual-history-edit', ?, ?, ?, ?, ?, ?)
          `).run(id, receiptId, line.description, line.description, line.quantity, line.unitPriceMinor, line.lineTotalMinor, line.discountMinor, timestamp, line.categoryId ?? null, line.unit, discountType, discountValue, discountQuantity);
        }
      }
      for (const current of existing) {
        if (!keptIds.has(current.id)) database.prepare('DELETE FROM receipt_items WHERE id = ? AND receipt_id = ?').run(current.id, receiptId);
      }
      database.prepare(`
        UPDATE receipts SET retailer_id = ?, store_id = ?, declared_total_minor = ?, purchased_at = ?, payment_status = ?, payment_method = ?, notes = ?, tax_minor = ?, receipt_discount_minor = ?, updated_at = ?
        WHERE id = ?
      `).run(retailerId, storeId, declaredTotalMinor, purchasedAt, paymentStatus, paymentMethod, notes, taxMinor, receiptDiscountMinor, timestamp, receiptId);
      for (const item of getReceiptItems(database, receiptId)) syncReceiptPriceObservation(database, item.id, retailerId, storeId, purchasedAt);
      database.exec('COMMIT');
    } catch (error) {
      database.exec('ROLLBACK');
      throw error;
    }
    return getReceipt(databasePath, receiptId);
  });
}

function receiptDeleteImpact(databasePath: string, receiptId: string): Readonly<Record<string, unknown>> {
  return withDatabase(databasePath, (database) => {
    const row = database.prepare(`${receiptSelect('WHERE receipts.id = ?')} LIMIT 1`).get(receiptId) as ReceiptRow | undefined;
    if (!row) throw new ApiError(404, 'RECEIPT_NOT_FOUND', 'Ticket was not found');
    const itemCount = count(database, 'SELECT COUNT(*) AS count FROM receipt_items WHERE receipt_id = ?', receiptId);
    const captures = count(database, 'SELECT COUNT(*) AS count FROM receipt_captures WHERE receipt_id = ?', receiptId);
    const extractions = count(database, 'SELECT COUNT(*) AS count FROM receipt_extractions WHERE receipt_id = ?', receiptId);
    const corrections = count(database, `SELECT COUNT(*) AS count FROM receipt_corrections WHERE receipt_item_id IN (SELECT id FROM receipt_items WHERE receipt_id = ?)`, receiptId);
    const retainedPriceObservations = count(database, `
      SELECT COUNT(*) AS count FROM price_observations
      JOIN external_evidence ON external_evidence.id = price_observations.evidence_id
      WHERE external_evidence.source_type = 'receipt' AND external_evidence.source_reference IN (
        SELECT 'receipt-item:' || id FROM receipt_items WHERE receipt_id = ?
      )
    `, receiptId);
    return {
      ticket: receiptRecord(row),
      itemCount,
      captures,
      extractions,
      corrections,
      retainedPriceObservations,
      canDelete: true,
      warning: retainedPriceObservations > 0
        ? 'Deleting the ticket removes its structured receipt record, captures and extraction data. Derived price observations are retained as independent historical evidence.'
        : 'Deleting the ticket removes its structured receipt record, captures and extraction data.',
    };
  }, true);
}

function deleteReceipt(databasePath: string, receiptId: string): void {
  withDatabase(databasePath, (database) => {
    const exists = database.prepare('SELECT id FROM receipts WHERE id = ?').get(receiptId);
    if (!exists) throw new ApiError(404, 'RECEIPT_NOT_FOUND', 'Ticket was not found');
    database.exec('BEGIN IMMEDIATE');
    try {
      database.prepare('DELETE FROM receipts WHERE id = ?').run(receiptId);
      database.exec('COMMIT');
    } catch (error) {
      database.exec('ROLLBACK');
      throw error;
    }
  });
}

export async function handleInventoryManagementRequest(context: InventoryApiContext): Promise<boolean> {
  if (context.pathname === '/api/v1/inventory/stores' && context.method === 'GET') {
    context.send(200, listStores(context.databasePath, context.searchParams));
    return true;
  }
  if (context.pathname === '/api/v1/inventory/stores' && context.method === 'POST') {
    context.send(201, { store: createStore(context.databasePath, await context.readJson()) });
    return true;
  }
  const storeImpactMatch = /^\/api\/v1\/inventory\/stores\/([^/]+)\/delete-impact$/.exec(context.pathname);
  if (storeImpactMatch?.[1] && context.method === 'GET') {
    context.send(200, { impact: storeDeleteImpact(context.databasePath, decodePathSegment(storeImpactMatch[1])) });
    return true;
  }
  const storeMatch = /^\/api\/v1\/inventory\/stores\/([^/]+)$/.exec(context.pathname);
  if (storeMatch?.[1]) {
    const storeId = decodePathSegment(storeMatch[1]);
    if (context.method === 'GET') context.send(200, { store: getStore(context.databasePath, storeId) });
    else if (context.method === 'PATCH') context.send(200, { store: updateStore(context.databasePath, storeId, await context.readJson()) });
    else if (context.method === 'DELETE') {
      deleteStore(context.databasePath, storeId);
      context.send(204, null);
    } else return false;
    return true;
  }
  if (context.pathname === '/api/v1/inventory/statistics' && context.method === 'GET') {
    context.send(200, { statistics: inventoryStatistics(context.databasePath, context.searchParams) });
    return true;
  }
  if (context.pathname === '/api/v1/inventory/tickets' && context.method === 'GET') {
    context.send(200, listReceipts(context.databasePath, context.searchParams));
    return true;
  }
  const ticketImpactMatch = /^\/api\/v1\/inventory\/tickets\/([^/]+)\/delete-impact$/.exec(context.pathname);
  if (ticketImpactMatch?.[1] && context.method === 'GET') {
    context.send(200, { impact: receiptDeleteImpact(context.databasePath, decodePathSegment(ticketImpactMatch[1])) });
    return true;
  }
  const ticketMatch = /^\/api\/v1\/inventory\/tickets\/([^/]+)$/.exec(context.pathname);
  if (ticketMatch?.[1]) {
    const receiptId = decodePathSegment(ticketMatch[1]);
    if (context.method === 'GET') context.send(200, { ticket: getReceipt(context.databasePath, receiptId) });
    else if (context.method === 'PATCH') context.send(200, { ticket: updateReceipt(context.databasePath, receiptId, await context.readJson()) });
    else if (context.method === 'DELETE') {
      deleteReceipt(context.databasePath, receiptId);
      context.send(204, null);
    } else return false;
    return true;
  }
  return false;
}
