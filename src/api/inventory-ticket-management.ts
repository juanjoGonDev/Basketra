import { DatabaseSync } from 'node:sqlite';
import {
  calculateReceiptLineDiscountMinor,
  calculateReceiptLineTotal,
  parseReceiptLineDiscount,
  type ReceiptLineDiscount,
} from '../domain/receipt.ts';
import { UNIT_VALUES } from '../domain/units.ts';
import { asArray, asEnum, asRecord, asSafeInteger, asString } from '../domain/validation.ts';
import { createId } from '../infrastructure/ids.ts';
import { ApiError } from './errors.ts';
import type { InventoryApiContext } from './inventory-management-core.ts';

const PAYMENT_STATUSES = ['paid', 'pending', 'cancelled'] as const;

type PaymentStatus = typeof PAYMENT_STATUSES[number];
type SqlValue = string | number | null;

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
  categoryId: string | null;
  quantity: number;
  unit: string;
  unitPriceMinor: number;
  discount?: ReceiptLineDiscount;
  lineTotalMinor: number;
  discountMinor: number;
}>;

type ReceiptDeleteImpact = Readonly<{
  ticket: Readonly<Record<string, unknown>>;
  itemCount: number;
  captures: number;
  extractions: number;
  corrections: number;
  externalEvidence: number;
  retainedPriceObservations: number;
  canDelete: boolean;
  warning: string;
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

function optionalString(value: unknown, path: string, max: number): string | null {
  if (value === undefined || value === null) return null;
  const normalized = asString(value, path, { max }).trim();
  return normalized || null;
}

function count(database: DatabaseSync, sql: string, ...params: SqlValue[]): number {
  return Number((database.prepare(sql).get(...params) as { count: number }).count);
}

function receiptSelect(whereSql = ''): string {
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

function storedDiscount(row: ReceiptItemRow): ReceiptLineDiscount | undefined {
  if (row.discountValue === 0) return undefined;
  if (row.discountType === 'percentage') {
    return {
      type: 'percentage',
      basisPoints: Number(row.discountValue),
      ...(row.discountQuantity === row.quantity ? {} : { quantity: Number(row.discountQuantity) }),
    };
  }
  return {
    type: 'amount',
    amountMinor: Number(row.discountValue),
    ...(row.discountQuantity === row.quantity ? {} : { quantity: Number(row.discountQuantity) }),
  };
}

function receiptItemRecord(row: ReceiptItemRow): Readonly<Record<string, unknown>> {
  const discount = storedDiscount(row);
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
    ...(discount ? { discount } : {}),
    lineTotalMinor: Number(row.lineTotalMinor),
    status: row.status,
    confidence: Number(row.confidence),
  };
}

function getReceiptFromDatabase(database: DatabaseSync, receiptId: string): Readonly<Record<string, unknown>> {
  const row = database.prepare(`${receiptSelect('WHERE receipts.id = ?')} LIMIT 1`).get(receiptId) as ReceiptRow | undefined;
  if (!row) throw new ApiError(404, 'RECEIPT_NOT_FOUND', 'Ticket was not found');
  return { ...receiptRecord(row), items: getReceiptItems(database, receiptId).map(receiptItemRecord) };
}

function getReceipt(databasePath: string, receiptId: string): Readonly<Record<string, unknown>> {
  return withDatabase(databasePath, database => getReceiptFromDatabase(database, receiptId), true);
}

function parseEditableLine(value: unknown, index: number): EditableReceiptLine {
  const candidate = asRecord(value, `$.items[${index}]`);
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

function ensureCategory(database: DatabaseSync, categoryId: string | null): void {
  if (!categoryId) return;
  if (!database.prepare('SELECT id FROM product_categories WHERE id = ?').get(categoryId)) {
    throw new ApiError(400, 'CATEGORY_NOT_FOUND', 'Ticket line category was not found');
  }
}

function updateExistingLine(
  database: DatabaseSync,
  receiptId: string,
  current: ReceiptItemRow,
  line: EditableReceiptLine,
  timestamp: string,
): void {
  correction(database, current.id, 'description', current.normalizedDescription ?? current.originalDescription, line.description, timestamp);
  correction(database, current.id, 'quantity', current.quantity, line.quantity, timestamp);
  correction(database, current.id, 'unitPriceMinor', current.unitPriceMinor, line.unitPriceMinor, timestamp);
  correction(database, current.id, 'categoryId', current.categoryId, line.categoryId, timestamp);
  correction(database, current.id, 'unit', current.unit, line.unit, timestamp);
  correction(database, current.id, 'discount', storedDiscount(current) ?? null, line.discount ?? null, timestamp);
  const discountType = line.discount?.type ?? 'amount';
  const discountValue = line.discount?.type === 'percentage' ? line.discount.basisPoints : line.discount?.amountMinor ?? 0;
  const discountQuantity = line.discount?.quantity ?? line.quantity;
  database.prepare(`
    UPDATE receipt_items
    SET normalized_description = ?, quantity = ?, unit_price_minor = ?, line_total_minor = ?, discount_minor = ?,
      category_id = ?, unit = ?, discount_type = ?, discount_value = ?, discount_quantity = ?, status = 'confirmed', confidence = 1
    WHERE id = ? AND receipt_id = ?
  `).run(
    line.description,
    line.quantity,
    line.unitPriceMinor,
    line.lineTotalMinor,
    line.discountMinor,
    line.categoryId,
    line.unit,
    discountType,
    discountValue,
    discountQuantity,
    current.id,
    receiptId,
  );
}

function insertManualLine(database: DatabaseSync, receiptId: string, line: EditableReceiptLine, timestamp: string): string {
  const id = createId('receipt_item');
  const discountType = line.discount?.type ?? 'amount';
  const discountValue = line.discount?.type === 'percentage' ? line.discount.basisPoints : line.discount?.amountMinor ?? 0;
  const discountQuantity = line.discount?.quantity ?? line.quantity;
  database.prepare(`
    INSERT INTO receipt_items(
      id, receipt_id, original_description, normalized_description, product_variant_id,
      quantity, unit_price_minor, line_total_minor, discount_minor, status, confidence,
      match_reason, created_at, category_id, unit, discount_type, discount_value, discount_quantity
    ) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, 'confirmed', 1, 'manual-history-edit', ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    receiptId,
    line.description,
    line.description,
    line.quantity,
    line.unitPriceMinor,
    line.lineTotalMinor,
    line.discountMinor,
    timestamp,
    line.categoryId,
    line.unit,
    discountType,
    discountValue,
    discountQuantity,
  );
  return id;
}

function tombstoneRemovedLine(database: DatabaseSync, receiptId: string, current: ReceiptItemRow, timestamp: string): void {
  correction(database, current.id, 'status', current.status, 'deleted', timestamp);
  database.prepare(`
    UPDATE receipt_items SET status = 'deleted' WHERE id = ? AND receipt_id = ?
  `).run(current.id, receiptId);
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
  if (!Number.isSafeInteger(beforeDiscount) || receiptDiscountMinor > beforeDiscount) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Ticket discount exceeds the subtotal and taxes');
  }
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
          updateExistingLine(database, receiptId, current, line, timestamp);
        } else {
          keptIds.add(insertManualLine(database, receiptId, line, timestamp));
        }
      }

      for (const current of existing) {
        if (!keptIds.has(current.id)) tombstoneRemovedLine(database, receiptId, current, timestamp);
      }

      database.prepare(`
        UPDATE receipts
        SET retailer_id = ?, store_id = ?, declared_total_minor = ?, purchased_at = ?, payment_status = ?,
          payment_method = ?, notes = ?, tax_minor = ?, receipt_discount_minor = ?, updated_at = ?
        WHERE id = ?
      `).run(
        retailerId,
        storeId,
        declaredTotalMinor,
        purchasedAt,
        paymentStatus,
        paymentMethod,
        notes,
        taxMinor,
        receiptDiscountMinor,
        timestamp,
        receiptId,
      );
      database.exec('COMMIT');
    } catch (error) {
      database.exec('ROLLBACK');
      throw error;
    }
    return getReceipt(databasePath, receiptId);
  });
}

function receiptDeleteImpactFromDatabase(database: DatabaseSync, receiptId: string): ReceiptDeleteImpact {
  const row = database.prepare(`${receiptSelect('WHERE receipts.id = ?')} LIMIT 1`).get(receiptId) as ReceiptRow | undefined;
  if (!row) throw new ApiError(404, 'RECEIPT_NOT_FOUND', 'Ticket was not found');
  const itemCount = count(database, 'SELECT COUNT(*) AS count FROM receipt_items WHERE receipt_id = ?', receiptId);
  const captures = count(database, 'SELECT COUNT(*) AS count FROM receipt_captures WHERE receipt_id = ?', receiptId);
  const extractions = count(database, 'SELECT COUNT(*) AS count FROM receipt_extractions WHERE receipt_id = ?', receiptId);
  const corrections = count(database, `
    SELECT COUNT(*) AS count FROM receipt_corrections
    WHERE receipt_item_id IN (SELECT id FROM receipt_items WHERE receipt_id = ?)
  `, receiptId);
  const externalEvidence = count(database, `
    SELECT COUNT(*) AS count FROM external_evidence
    WHERE source_type = 'receipt' AND source_reference IN (
      SELECT 'receipt-item:' || id FROM receipt_items WHERE receipt_id = ?
    )
  `, receiptId);
  const retainedPriceObservations = count(database, `
    SELECT COUNT(*) AS count FROM price_observations
    JOIN external_evidence ON external_evidence.id = price_observations.evidence_id
    WHERE external_evidence.source_type = 'receipt' AND external_evidence.source_reference IN (
      SELECT 'receipt-item:' || id FROM receipt_items WHERE receipt_id = ?
    )
  `, receiptId);
  const canDelete = captures === 0
    && extractions === 0
    && corrections === 0
    && externalEvidence === 0
    && retainedPriceObservations === 0;
  return {
    ticket: receiptRecord(row),
    itemCount,
    captures,
    extractions,
    corrections,
    externalEvidence,
    retainedPriceObservations,
    canDelete,
    warning: canDelete
      ? 'This ticket has no immutable capture, extraction, correction or price evidence and can be hard-deleted.'
      : 'This ticket has immutable receipt or price evidence. Hard deletion is blocked to preserve historical evidence.',
  };
}

function receiptDeleteImpact(databasePath: string, receiptId: string): ReceiptDeleteImpact {
  return withDatabase(databasePath, database => receiptDeleteImpactFromDatabase(database, receiptId), true);
}

function deleteReceipt(databasePath: string, receiptId: string): void {
  withDatabase(databasePath, (database) => {
    database.exec('BEGIN IMMEDIATE');
    try {
      const impact = receiptDeleteImpactFromDatabase(database, receiptId);
      if (!impact.canDelete) {
        throw new ApiError(409, 'RECEIPT_DELETE_BLOCKED', 'Ticket has immutable receipt or price evidence and cannot be hard-deleted');
      }
      database.prepare('DELETE FROM receipts WHERE id = ?').run(receiptId);
      database.exec('COMMIT');
    } catch (error) {
      database.exec('ROLLBACK');
      throw error;
    }
  });
}

export async function handleInventoryTicketManagementRequest(context: InventoryApiContext): Promise<boolean> {
  const impactMatch = /^\/api\/v1\/inventory\/tickets\/([^/]+)\/delete-impact$/.exec(context.pathname);
  if (impactMatch?.[1] && context.method === 'GET') {
    context.send(200, { impact: receiptDeleteImpact(context.databasePath, decodePathSegment(impactMatch[1])) });
    return true;
  }

  const ticketMatch = /^\/api\/v1\/inventory\/tickets\/([^/]+)$/.exec(context.pathname);
  if (!ticketMatch?.[1]) return false;
  const receiptId = decodePathSegment(ticketMatch[1]);

  if (context.method === 'GET') {
    context.send(200, { ticket: getReceipt(context.databasePath, receiptId) });
    return true;
  }
  if (context.method === 'PATCH') {
    context.send(200, { ticket: updateReceipt(context.databasePath, receiptId, await context.readJson()) });
    return true;
  }
  if (context.method === 'DELETE') {
    deleteReceipt(context.databasePath, receiptId);
    context.send(204, null);
    return true;
  }
  return false;
}
