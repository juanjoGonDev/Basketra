import { DatabaseSync } from 'node:sqlite';
import { ApiError } from './errors.ts';

const PAYMENT_STATUSES = ['paid', 'pending', 'cancelled'] as const;
const STATISTIC_PERIODS = ['30d', '90d', 'year', 'all'] as const;
const DEFAULT_PAGE_SIZE = 12;
const MAX_PAGE_SIZE = 100;

type SqlValue = string | number;
type PaymentStatus = typeof PAYMENT_STATUSES[number];
type StatisticPeriod = typeof STATISTIC_PERIODS[number];

export type InventoryReadModelContext = Readonly<{
  method?: string | undefined;
  pathname: string;
  searchParams: URLSearchParams;
  databasePath: string;
  send(status: number, body: unknown): void;
}>;

type ReceiptListRow = Readonly<{
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

function withDatabase<T>(path: string, callback: (database: DatabaseSync) => T): T {
  const database = new DatabaseSync(path, { readOnly: true });
  try {
    return callback(database);
  } finally {
    database.close();
  }
}

function normalizeText(value: string): string {
  return value.replace(/\s+/gu, ' ').trim();
}

function integerParameter(value: string | null, fallback: number, label: string, min: number, max: number): number {
  const parsed = value === null ? fallback : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) throw new ApiError(400, 'VALIDATION_ERROR', `${label} is invalid`);
  return parsed;
}

function enumParameter<T extends string>(value: string | null, fallback: T, allowed: readonly T[], label: string): T {
  if (value === null) return fallback;
  if (!allowed.includes(value as T)) throw new ApiError(400, 'VALIDATION_ERROR', `${label} is invalid`);
  return value as T;
}

function count(database: DatabaseSync, sql: string, ...params: SqlValue[]): number {
  return Number((database.prepare(sql).get(...params) as { count: number }).count);
}

function periodStart(period: StatisticPeriod): string | null {
  if (period === 'all') return null;
  const start = new Date();
  if (period === '30d') start.setUTCDate(start.getUTCDate() - 30);
  else if (period === '90d') start.setUTCDate(start.getUTCDate() - 90);
  else start.setUTCFullYear(start.getUTCFullYear() - 1);
  return start.toISOString();
}

function statistics(databasePath: string, params: URLSearchParams): Readonly<Record<string, unknown>> {
  const period = enumParameter(params.get('period'), '30d', STATISTIC_PERIODS, 'statistics period');
  const start = periodStart(period);
  return withDatabase(databasePath, (database) => {
    const activeProducts = count(database, 'SELECT COUNT(*) AS count FROM product_variants');
    const uncategorizedProducts = count(database, "SELECT COUNT(*) AS count FROM canonical_products WHERE category_id IS NULL OR category_id = 'category_unknown'");
    const latestCatalogValueMinor = Number((database.prepare(`
      WITH ranked AS (
        SELECT retailer_listings.product_variant_id AS productVariantId,
          price_observations.price_minor AS priceMinor,
          ROW_NUMBER() OVER (
            PARTITION BY retailer_listings.product_variant_id
            ORDER BY price_observations.observed_at DESC, price_observations.id DESC
          ) AS rank
        FROM price_observations
        JOIN retailer_listings ON retailer_listings.id = price_observations.retailer_listing_id
        WHERE retailer_listings.product_variant_id IS NOT NULL
      )
      SELECT COALESCE(SUM(priceMinor), 0) AS value FROM ranked WHERE rank = 1
    `).get() as { value: number }).value);

    const periodCondition = start ? 'AND COALESCE(purchased_at, created_at) >= ?' : '';
    const periodValues: SqlValue[] = start ? [start] : [];
    const ticketSummary = database.prepare(`
      SELECT COUNT(*) AS ticketCount,
        SUM(CASE WHEN payment_status <> 'cancelled' THEN 1 ELSE 0 END) AS financialTicketCount,
        COALESCE(SUM(CASE WHEN payment_status <> 'cancelled' THEN declared_total_minor ELSE 0 END), 0) AS totalSpentMinor
      FROM receipts WHERE 1 = 1 ${periodCondition}
    `).get(...periodValues) as { ticketCount: number; financialTicketCount: number; totalSpentMinor: number };
    const entriesValueMinor = Number((database.prepare(`
      SELECT COALESCE(SUM(receipt_items.line_total_minor), 0) AS value
      FROM receipt_items
      JOIN receipts ON receipts.id = receipt_items.receipt_id
      WHERE receipt_items.status <> 'deleted'
        ${start ? 'AND COALESCE(receipts.purchased_at, receipts.created_at) >= ?' : ''}
    `).get(...periodValues) as { value: number }).value);

    const categoryRows = database.prepare(`
      SELECT product_categories.id, product_categories.name,
        (SELECT COUNT(*) FROM canonical_products WHERE canonical_products.category_id = product_categories.id) AS productCount
      FROM product_categories
      ORDER BY product_categories.name COLLATE NOCASE, product_categories.id
    `).all() as Array<{ id: string; name: string; productCount: number }>;
    const categoryStats = categoryRows.map((category) => {
      const dateClause = start ? 'AND COALESCE(receipts.purchased_at, receipts.created_at) >= ?' : '';
      const values: SqlValue[] = [category.id, category.id, ...periodValues];
      const row = database.prepare(`
        SELECT COUNT(DISTINCT receipts.id) AS ticketCount,
          COALESCE(SUM(CASE WHEN receipts.payment_status <> 'cancelled' THEN receipt_items.line_total_minor ELSE 0 END), 0) AS spentMinor
        FROM receipt_items
        JOIN receipts ON receipts.id = receipt_items.receipt_id
        WHERE receipt_items.status <> 'deleted'
          AND (
            receipt_items.category_id = ?
            OR EXISTS (
              SELECT 1
              FROM product_variants
              JOIN canonical_products ON canonical_products.id = product_variants.canonical_product_id
              WHERE product_variants.id = receipt_items.product_variant_id
                AND canonical_products.category_id = ?
            )
          )
          ${dateClause}
      `).get(...values) as { ticketCount: number; spentMinor: number };
      return {
        id: category.id,
        name: category.name,
        productCount: Number(category.productCount),
        ticketCount: Number(row.ticketCount),
        spentMinor: Number(row.spentMinor),
      };
    }).sort((left, right) => right.spentMinor - left.spentMinor || left.name.localeCompare(right.name, 'es')).slice(0, 20);

    const storeRows = database.prepare(`
      SELECT stores.id, stores.name, retailers.name AS retailerName,
        (SELECT COUNT(DISTINCT retailer_listings.product_variant_id)
          FROM price_observations
          JOIN retailer_listings ON retailer_listings.id = price_observations.retailer_listing_id
          WHERE price_observations.store_id = stores.id AND retailer_listings.product_variant_id IS NOT NULL) AS productCount
      FROM stores
      JOIN retailers ON retailers.id = stores.retailer_id
      ORDER BY stores.name COLLATE NOCASE, stores.id
    `).all() as Array<{ id: string; name: string; retailerName: string; productCount: number }>;
    const storeStats = storeRows.map((store) => {
      const row = database.prepare(`
        SELECT COUNT(*) AS ticketCount,
          COALESCE(SUM(CASE WHEN payment_status <> 'cancelled' THEN declared_total_minor ELSE 0 END), 0) AS spentMinor
        FROM receipts
        WHERE store_id = ? ${start ? 'AND COALESCE(purchased_at, created_at) >= ?' : ''}
      `).get(store.id, ...periodValues) as { ticketCount: number; spentMinor: number };
      return {
        id: store.id,
        name: store.name,
        retailerName: store.retailerName,
        productCount: Number(store.productCount),
        ticketCount: Number(row.ticketCount),
        spentMinor: Number(row.spentMinor),
      };
    }).sort((left, right) => right.ticketCount - left.ticketCount || right.productCount - left.productCount || left.name.localeCompare(right.name, 'es')).slice(0, 20);

    const ticketTrend = database.prepare(`
      SELECT substr(COALESCE(purchased_at, created_at), 1, 10) AS date,
        COUNT(*) AS ticketCount,
        COALESCE(SUM(CASE WHEN payment_status <> 'cancelled' THEN declared_total_minor ELSE 0 END), 0) AS spentMinor
      FROM receipts
      WHERE 1 = 1 ${periodCondition}
      GROUP BY date ORDER BY date
    `).all(...periodValues) as Array<{ date: string; ticketCount: number; spentMinor: number }>;

    return {
      period,
      summary: {
        latestCatalogValueMinor,
        activeProducts,
        ticketsProcessed: Number(ticketSummary.ticketCount),
        totalSpentMinor: Number(ticketSummary.totalSpentMinor),
        entriesValueMinor,
        uncategorizedProducts,
        lowStockProducts: null,
        lowStockUnavailableReason: 'Stock thresholds are not part of the current canonical inventory model.',
      },
      categoryStats,
      storeStats,
      ticketTrend: ticketTrend.map(row => ({ date: row.date, ticketCount: Number(row.ticketCount), spentMinor: Number(row.spentMinor) })),
    };
  });
}

function ticketWhere(params: URLSearchParams): Readonly<{ sql: string; values: readonly SqlValue[] }> {
  const conditions: string[] = [];
  const values: SqlValue[] = [];
  const query = normalizeText(params.get('q') ?? '');
  if (query.length > 160) throw new ApiError(400, 'VALIDATION_ERROR', 'Ticket query is too long');
  if (query) {
    const like = `%${query}%`;
    const alternatives = [
      "COALESCE(stores.name, retailers.name, '') LIKE ? COLLATE NOCASE",
      "COALESCE(receipts.notes, '') LIKE ? COLLATE NOCASE",
      'receipts.id LIKE ? COLLATE NOCASE',
    ];
    values.push(like, like, like);
    const amount = Number(query.replace(',', '.'));
    if (Number.isFinite(amount) && amount >= 0) {
      alternatives.push('receipts.declared_total_minor = ?');
      values.push(Math.round(amount * 100));
    }
    conditions.push(`(${alternatives.join(' OR ')})`);
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
    conditions.push('EXISTS (SELECT 1 FROM receipt_items WHERE receipt_items.receipt_id = receipts.id AND receipt_items.status <> \'deleted\' AND receipt_items.category_id = ?)');
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

function receiptRecord(row: ReceiptListRow): Readonly<Record<string, unknown>> {
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

function tickets(databasePath: string, params: URLSearchParams): Readonly<Record<string, unknown>> {
  const limit = integerParameter(params.get('limit'), DEFAULT_PAGE_SIZE, 'ticket limit', 1, MAX_PAGE_SIZE);
  const offset = integerParameter(params.get('offset'), 0, 'ticket offset', 0, 10_000);
  const where = ticketWhere(params);
  return withDatabase(databasePath, (database) => {
    const total = count(database, `SELECT COUNT(*) AS count FROM receipts LEFT JOIN retailers ON retailers.id = receipts.retailer_id LEFT JOIN stores ON stores.id = receipts.store_id ${where.sql}`, ...where.values);
    const rows = database.prepare(`
      SELECT receipts.id, receipts.retailer_id AS retailerId, retailers.name AS retailerName,
        receipts.store_id AS storeId, stores.name AS storeName,
        receipts.declared_total_minor AS declaredTotalMinor, receipts.purchased_at AS purchasedAt,
        receipts.created_at AS createdAt, receipts.updated_at AS updatedAt,
        receipts.payment_status AS paymentStatus, receipts.payment_method AS paymentMethod,
        receipts.notes, receipts.tax_minor AS taxMinor, receipts.receipt_discount_minor AS receiptDiscountMinor,
        (SELECT COUNT(*) FROM receipt_items WHERE receipt_items.receipt_id = receipts.id AND receipt_items.status <> 'deleted') AS itemCount
      FROM receipts
      LEFT JOIN retailers ON retailers.id = receipts.retailer_id
      LEFT JOIN stores ON stores.id = receipts.store_id
      ${where.sql}
      ORDER BY COALESCE(receipts.purchased_at, receipts.created_at) DESC, receipts.id DESC
      LIMIT ? OFFSET ?
    `).all(...where.values, limit, offset) as ReceiptListRow[];
    const summary = database.prepare(`
      SELECT COUNT(*) AS ticketCount,
        SUM(CASE WHEN receipts.payment_status <> 'cancelled' THEN 1 ELSE 0 END) AS financialTicketCount,
        COALESCE(SUM(CASE WHEN receipts.payment_status <> 'cancelled' THEN receipts.declared_total_minor ELSE 0 END), 0) AS totalSpentMinor,
        COALESCE(SUM((SELECT COUNT(*) FROM receipt_items WHERE receipt_items.receipt_id = receipts.id AND receipt_items.status <> 'deleted')), 0) AS itemCount
      FROM receipts
      LEFT JOIN retailers ON retailers.id = receipts.retailer_id
      LEFT JOIN stores ON stores.id = receipts.store_id
      ${where.sql}
    `).get(...where.values) as { ticketCount: number; financialTicketCount: number; totalSpentMinor: number; itemCount: number };
    const financialTicketCount = Number(summary.financialTicketCount);
    const totalSpentMinor = Number(summary.totalSpentMinor);
    return {
      tickets: rows.map(receiptRecord),
      total,
      limit,
      offset,
      hasMore: offset + rows.length < total,
      summary: {
        ticketCount: Number(summary.ticketCount),
        totalSpentMinor,
        itemCount: Number(summary.itemCount),
        averageTicketMinor: financialTicketCount === 0 ? 0 : Math.round(totalSpentMinor / financialTicketCount),
      },
    };
  });
}

export function handleInventoryReadModelRequest(context: InventoryReadModelContext): boolean {
  if (context.method !== 'GET') return false;
  if (context.pathname === '/api/v1/inventory/statistics') {
    context.send(200, { statistics: statistics(context.databasePath, context.searchParams) });
    return true;
  }
  if (context.pathname === '/api/v1/inventory/tickets') {
    context.send(200, tickets(context.databasePath, context.searchParams));
    return true;
  }
  return false;
}
