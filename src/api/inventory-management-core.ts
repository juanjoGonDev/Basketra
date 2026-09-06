import { DatabaseSync } from 'node:sqlite';
import { asEnum, asRecord, asSafeInteger, asString } from '../domain/validation.ts';
import { createId } from '../infrastructure/ids.ts';
import { ApiError } from './errors.ts';

const STORE_SORTS = ['name', 'recent', 'activity'] as const;
const DEFAULT_PAGE_SIZE = 12;
const MAX_PAGE_SIZE = 100;

type SqlValue = string | number | null;
type StoreSort = typeof STORE_SORTS[number];

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
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    throw new ApiError(400, 'VALIDATION_ERROR', `${path} is invalid`);
  }
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
    const total = count(
      database,
      `SELECT COUNT(*) AS count FROM stores JOIN retailers ON retailers.id = stores.retailer_id ${where}`,
      ...values,
    );
    const rows = database.prepare(`${storeSelectSql(where, storeOrder(sort))} LIMIT ? OFFSET ?`)
      .all(...values, limit, offset) as StoreRow[];
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
  const existing = database.prepare('SELECT id FROM retailers WHERE name = ? COLLATE NOCASE')
    .get(retailerName) as { id: string } | undefined;
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
    latitudeMicrodegrees: hasLatitude
      ? asSafeInteger(candidate['latitudeMicrodegrees'], '$.latitudeMicrodegrees', { min: -90_000_000, max: 90_000_000 })
      : null,
    longitudeMicrodegrees: hasLongitude
      ? asSafeInteger(candidate['longitudeMicrodegrees'], '$.longitudeMicrodegrees', { min: -180_000_000, max: 180_000_000 })
      : null,
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
        const duplicate = database.prepare('SELECT id FROM stores WHERE osm_type = ? AND osm_id = ?')
          .get(input.osmType, input.osmId);
        if (duplicate) throw new ApiError(409, 'STORE_OSM_IDENTITY_EXISTS', 'A store with this OpenStreetMap identity already exists');
      }
      const retailerId = resolveRetailer(database, input.retailerName, timestamp);
      const id = createId('store');
      database.prepare(`
        INSERT INTO stores(id, retailer_id, name, region, address, latitude_microdegrees, longitude_microdegrees, osm_type, osm_id, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        retailerId,
        input.name,
        input.region,
        input.address,
        input.latitudeMicrodegrees,
        input.longitudeMicrodegrees,
        input.osmType,
        input.osmId,
        timestamp,
      );
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
        const duplicate = database.prepare('SELECT id FROM stores WHERE osm_type = ? AND osm_id = ? AND id <> ?')
          .get(input.osmType, input.osmId, storeId);
        if (duplicate) throw new ApiError(409, 'STORE_OSM_IDENTITY_EXISTS', 'A store with this OpenStreetMap identity already exists');
      }
      const retailerId = resolveRetailer(database, input.retailerName, timestamp);
      database.prepare(`
        UPDATE stores
        SET retailer_id = ?, name = ?, region = ?, address = ?, latitude_microdegrees = ?, longitude_microdegrees = ?, osm_type = ?, osm_id = ?
        WHERE id = ?
      `).run(
        retailerId,
        input.name,
        input.region,
        input.address,
        input.latitudeMicrodegrees,
        input.longitudeMicrodegrees,
        input.osmType,
        input.osmId,
        storeId,
      );
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
    const shoppingLists = count(database, `
      SELECT COUNT(DISTINCT shopping_lists.id) AS count
      FROM shopping_lists
      LEFT JOIN shopping_list_items ON shopping_list_items.list_id = shopping_lists.id
      WHERE shopping_lists.reference_store_id = ? OR shopping_list_items.store_override_id = ?
    `, storeId, storeId);
    return {
      linkedProducts,
      priceObservations,
      historicalTickets,
      shoppingLists,
      canDelete: priceObservations === 0 && historicalTickets === 0 && shoppingLists === 0,
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
      const shoppingLists = count(database, `
        SELECT COUNT(DISTINCT shopping_lists.id) AS count
        FROM shopping_lists
        LEFT JOIN shopping_list_items ON shopping_list_items.list_id = shopping_lists.id
        WHERE shopping_lists.reference_store_id = ? OR shopping_list_items.store_override_id = ?
      `, storeId, storeId);
      if (priceObservations > 0 || historicalTickets > 0 || shoppingLists > 0) {
        throw new ApiError(409, 'STORE_DELETE_BLOCKED', 'Store has historical price, ticket or shopping-list dependencies');
      }
      database.prepare('DELETE FROM stores WHERE id = ?').run(storeId);
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
  if (!storeMatch?.[1]) return false;
  const storeId = decodePathSegment(storeMatch[1]);
  if (context.method === 'GET') context.send(200, { store: getStore(context.databasePath, storeId) });
  else if (context.method === 'PATCH') context.send(200, { store: updateStore(context.databasePath, storeId, await context.readJson()) });
  else if (context.method === 'DELETE') {
    deleteStore(context.databasePath, storeId);
    context.send(204, null);
  } else return false;
  return true;
}
