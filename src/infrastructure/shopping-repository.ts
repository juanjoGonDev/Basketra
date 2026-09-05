import type { DatabaseSync } from 'node:sqlite';
import { createId } from './ids.ts';

export type ShoppingListRecord = Readonly<{
  id: string;
  name: string;
  version: number;
  referenceStoreId?: string;
  createdAt: string;
  updatedAt: string;
}>;

export type ShoppingListSummaryRecord = ShoppingListRecord & Readonly<{
  pendingCount: number;
  completedCount: number;
}>;

export type ShoppingListItemRecord = Readonly<{
  id: string;
  listId: string;
  text: string;
  quantityMinor: number;
  unit: string;
  exactRequired: boolean;
  substitutionAllowed: boolean;
  completed: boolean;
  completedAt?: string;
  position: number;
  version: number;
  productVariantId?: string;
  storeOverrideId?: string;
  categoryId?: string;
  categoryName?: string;
  createdAt: string;
  updatedAt: string;
}>;

export type ShoppingConflictKind = 'list' | 'item' | 'reorder';

export class ShoppingConflictError extends Error {
  readonly kind: ShoppingConflictKind;
  readonly current: ShoppingListRecord | ShoppingListItemRecord | Readonly<{ list: ShoppingListRecord; items: readonly ShoppingListItemRecord[] }>;

  constructor(kind: ShoppingConflictKind, current: ShoppingConflictError['current']) {
    super('SHOPPING_CONFLICT');
    this.name = 'ShoppingConflictError';
    this.kind = kind;
    this.current = current;
  }
}

type ListRow = Omit<ShoppingListRecord, 'referenceStoreId'> & Readonly<{
  referenceStoreId: string | null;
}>;

type ItemRow = Omit<ShoppingListItemRecord, 'exactRequired' | 'substitutionAllowed' | 'completed' | 'completedAt' | 'productVariantId' | 'storeOverrideId' | 'categoryId' | 'categoryName'> & Readonly<{
  exactRequired: number;
  substitutionAllowed: number;
  completed: number;
  completedAt: string | null;
  productVariantId: string | null;
  storeOverrideId: string | null;
  categoryId: string | null;
  categoryName: string | null;
}>;

function mapList(row: ListRow): ShoppingListRecord {
  const { referenceStoreId, ...base } = row;
  return { ...base, ...(referenceStoreId ? { referenceStoreId } : {}) };
}

function mapItem(row: ItemRow): ShoppingListItemRecord {
  return {
    id: row.id,
    listId: row.listId,
    text: row.text,
    quantityMinor: row.quantityMinor,
    unit: row.unit,
    exactRequired: row.exactRequired === 1,
    substitutionAllowed: row.substitutionAllowed === 1,
    completed: row.completed === 1,
    ...(row.completedAt ? { completedAt: row.completedAt } : {}),
    position: row.position,
    version: row.version,
    ...(row.productVariantId ? { productVariantId: row.productVariantId } : {}),
    ...(row.storeOverrideId ? { storeOverrideId: row.storeOverrideId } : {}),
    ...(row.categoryId ? { categoryId: row.categoryId } : {}),
    ...(row.categoryName ? { categoryName: row.categoryName } : {}),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export class ShoppingRepository {
  readonly #database: DatabaseSync;
  readonly #clock: () => Date;

  constructor(database: DatabaseSync, clock: () => Date) {
    this.#database = database;
    this.#clock = clock;
  }

  createList(name: string): ShoppingListRecord {
    const id = createId('list');
    const timestamp = this.#clock().toISOString();
    this.#database.prepare('INSERT INTO shopping_lists(id, name, created_at, updated_at) VALUES (?, ?, ?, ?)').run(id, name, timestamp, timestamp);
    return { id, name, version: 1, createdAt: timestamp, updatedAt: timestamp };
  }

  listLists(): ShoppingListSummaryRecord[] {
    return this.#database.prepare(`
      SELECT
        shopping_lists.id,
        shopping_lists.name,
        shopping_lists.version,
        shopping_lists.reference_store_id AS referenceStoreId,
        shopping_lists.created_at AS createdAt,
        shopping_lists.updated_at AS updatedAt,
        SUM(CASE WHEN shopping_list_items.id IS NOT NULL AND shopping_list_items.completed = 0 THEN 1 ELSE 0 END) AS pendingCount,
        SUM(CASE WHEN shopping_list_items.id IS NOT NULL AND shopping_list_items.completed = 1 THEN 1 ELSE 0 END) AS completedCount
      FROM shopping_lists
      LEFT JOIN shopping_list_items ON shopping_list_items.list_id = shopping_lists.id
      GROUP BY shopping_lists.id
      ORDER BY shopping_lists.updated_at DESC, shopping_lists.id
    `).all().map((row) => {
      const value = row as ListRow & { pendingCount: number; completedCount: number };
      return { ...mapList(value), pendingCount: Number(value.pendingCount), completedCount: Number(value.completedCount) };
    }) as ShoppingListSummaryRecord[];
  }

  getList(id: string): Readonly<{ list: ShoppingListRecord; items: ShoppingListItemRecord[] }> | undefined {
    const list = this.listById(id);
    if (!list) return undefined;
    const rows = this.#database.prepare(`
      SELECT
        shopping_list_items.id,
        shopping_list_items.list_id AS listId,
        shopping_list_items.text,
        shopping_list_items.quantity_minor AS quantityMinor,
        shopping_list_items.unit,
        shopping_list_items.exact_required AS exactRequired,
        shopping_list_items.substitution_allowed AS substitutionAllowed,
        shopping_list_items.completed,
        shopping_list_items.completed_at AS completedAt,
        shopping_list_items.position,
        shopping_list_items.version,
        shopping_list_items.product_variant_id AS productVariantId,
        shopping_list_items.store_override_id AS storeOverrideId,
        product_categories.id AS categoryId,
        product_categories.name AS categoryName,
        shopping_list_items.created_at AS createdAt,
        shopping_list_items.updated_at AS updatedAt
      FROM shopping_list_items
      LEFT JOIN product_variants ON product_variants.id = shopping_list_items.product_variant_id
      LEFT JOIN canonical_products ON canonical_products.id = product_variants.canonical_product_id
      LEFT JOIN product_categories ON product_categories.id = canonical_products.category_id
      WHERE shopping_list_items.list_id = ?
      ORDER BY shopping_list_items.position, shopping_list_items.id
    `).all(id) as ItemRow[];
    return { list, items: rows.map(mapItem) };
  }

  updateList(id: string, name: string, expectedVersion: number): ShoppingListRecord | undefined {
    assertVersion(expectedVersion);
    const timestamp = this.#clock().toISOString();
    const result = this.#database.prepare(`
      UPDATE shopping_lists
      SET name = ?, updated_at = ?, version = version + 1
      WHERE id = ? AND version = ?
    `).run(name, timestamp, id, expectedVersion);
    if (Number(result.changes) === 0) {
      const current = this.listById(id);
      if (!current) return undefined;
      throw new ShoppingConflictError('list', current);
    }
    return this.listById(id);
  }

  setStoreSelection(
    listId: string,
    referenceStoreId: string | null,
    expectedVersion: number,
    scope: 'default' | 'all',
  ): Readonly<{ list: ShoppingListRecord; items: ShoppingListItemRecord[] }> {
    assertVersion(expectedVersion);
    this.#database.exec('BEGIN IMMEDIATE');
    try {
      const current = this.listById(listId);
      if (!current) throw new Error('SHOPPING_LIST_NOT_FOUND');
      if (current.version !== expectedVersion) throw new ShoppingConflictError('list', current);
      if (referenceStoreId) this.assertStoreExists(referenceStoreId);

      const timestamp = this.#clock().toISOString();
      if (scope === 'all') {
        this.#database.prepare(`
          UPDATE shopping_list_items
          SET store_override_id = NULL, updated_at = ?, version = version + 1
          WHERE list_id = ? AND store_override_id IS NOT NULL
        `).run(timestamp, listId);
      }

      const changed = this.#database.prepare(`
        UPDATE shopping_lists
        SET reference_store_id = ?, updated_at = ?, version = version + 1
        WHERE id = ? AND version = ?
      `).run(referenceStoreId, timestamp, listId, expectedVersion);
      if (Number(changed.changes) === 0) {
        const latest = this.listById(listId);
        if (!latest) throw new Error('SHOPPING_LIST_NOT_FOUND');
        throw new ShoppingConflictError('list', latest);
      }

      const updated = this.getList(listId);
      if (!updated) throw new Error('SHOPPING_LIST_NOT_FOUND');
      this.#database.exec('COMMIT');
      return updated;
    } catch (error) {
      this.#database.exec('ROLLBACK');
      throw error;
    }
  }

  deleteList(id: string, expectedVersion: number): boolean {
    assertVersion(expectedVersion);
    const result = this.#database.prepare('DELETE FROM shopping_lists WHERE id = ? AND version = ?').run(id, expectedVersion);
    if (Number(result.changes) > 0) return true;
    const current = this.listById(id);
    if (!current) return false;
    throw new ShoppingConflictError('list', current);
  }

  addItem(input: Readonly<{
    listId: string;
    text: string;
    quantityMinor: number;
    unit: string;
    exactRequired: boolean;
    substitutionAllowed: boolean;
    productVariantId?: string;
    storeOverrideId?: string;
  }>): ShoppingListItemRecord {
    this.#database.exec('BEGIN IMMEDIATE');
    try {
      this.assertListExists(input.listId);
      if (input.productVariantId) this.assertProductVariantExists(input.productVariantId);
      if (input.storeOverrideId) this.assertStoreExists(input.storeOverrideId);
      const position = Number((this.#database.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS position FROM shopping_list_items WHERE list_id = ?').get(input.listId) as { position: number }).position);
      const id = createId('item');
      const timestamp = this.#clock().toISOString();
      this.#database.prepare(`
        INSERT INTO shopping_list_items(
          id, list_id, text, quantity_minor, unit, exact_required, substitution_allowed,
          position, product_variant_id, store_override_id, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        input.listId,
        input.text,
        input.quantityMinor,
        input.unit,
        input.exactRequired ? 1 : 0,
        input.substitutionAllowed ? 1 : 0,
        position,
        input.productVariantId ?? null,
        input.storeOverrideId ?? null,
        timestamp,
        timestamp,
      );
      this.touchList(input.listId, timestamp);
      const created = this.itemById(input.listId, id);
      if (!created) throw new Error('SHOPPING_LIST_ITEM_NOT_FOUND');
      this.#database.exec('COMMIT');
      return created;
    } catch (error) {
      this.#database.exec('ROLLBACK');
      throw error;
    }
  }

  updateItem(input: Readonly<{
    listId: string;
    itemId: string;
    expectedVersion: number;
    text?: string;
    quantityMinor?: number;
    quantityDelta?: number;
    unit?: string;
    exactRequired?: boolean;
    substitutionAllowed?: boolean;
    completed?: boolean;
    productVariantId?: string | null;
    storeOverrideId?: string | null;
  }>): ShoppingListItemRecord {
    assertVersion(input.expectedVersion);
    this.#database.exec('BEGIN IMMEDIATE');
    try {
      this.assertListExists(input.listId);
      const existing = this.itemById(input.listId, input.itemId);
      if (!existing) throw new Error('SHOPPING_LIST_ITEM_NOT_FOUND');
      if (input.quantityMinor !== undefined && input.quantityDelta !== undefined) {
        throw new RangeError('quantityMinor and quantityDelta cannot be combined');
      }
      if (input.productVariantId) this.assertProductVariantExists(input.productVariantId);
      if (input.storeOverrideId) this.assertStoreExists(input.storeOverrideId);
      const quantityMinor = input.quantityDelta === undefined
        ? input.quantityMinor ?? existing.quantityMinor
        : existing.quantityMinor + input.quantityDelta;
      if (!Number.isSafeInteger(quantityMinor) || quantityMinor <= 0 || quantityMinor > 100_000) {
        throw new RangeError('Shopping list item quantity is outside allowed limits');
      }
      const timestamp = this.#clock().toISOString();
      const completed = input.completed ?? existing.completed;
      const completedAt = completed
        ? existing.completed && existing.completedAt ? existing.completedAt : timestamp
        : null;
      const productVariantId = input.productVariantId === undefined
        ? existing.productVariantId ?? null
        : input.productVariantId;
      const storeOverrideId = input.storeOverrideId === undefined
        ? existing.storeOverrideId ?? null
        : input.storeOverrideId;
      const result = this.#database.prepare(`
        UPDATE shopping_list_items
        SET
          text = ?, quantity_minor = ?, unit = ?, exact_required = ?, substitution_allowed = ?,
          completed = ?, completed_at = ?, product_variant_id = ?, store_override_id = ?, updated_at = ?, version = version + 1
        WHERE id = ? AND list_id = ? AND version = ?
      `).run(
        input.text ?? existing.text,
        quantityMinor,
        input.unit ?? existing.unit,
        (input.exactRequired ?? existing.exactRequired) ? 1 : 0,
        (input.substitutionAllowed ?? existing.substitutionAllowed) ? 1 : 0,
        completed ? 1 : 0,
        completedAt,
        productVariantId,
        storeOverrideId,
        timestamp,
        input.itemId,
        input.listId,
        input.expectedVersion,
      );
      if (Number(result.changes) === 0) {
        const current = this.itemById(input.listId, input.itemId);
        if (!current) throw new Error('SHOPPING_LIST_ITEM_NOT_FOUND');
        throw new ShoppingConflictError('item', current);
      }
      this.touchList(input.listId, timestamp);
      const updated = this.itemById(input.listId, input.itemId);
      if (!updated) throw new Error('SHOPPING_LIST_ITEM_NOT_FOUND');
      this.#database.exec('COMMIT');
      return updated;
    } catch (error) {
      this.#database.exec('ROLLBACK');
      throw error;
    }
  }

  deleteItem(listId: string, itemId: string, expectedVersion: number): void {
    assertVersion(expectedVersion);
    this.#database.exec('BEGIN IMMEDIATE');
    try {
      this.assertListExists(listId);
      const result = this.#database.prepare('DELETE FROM shopping_list_items WHERE id = ? AND list_id = ? AND version = ?').run(itemId, listId, expectedVersion);
      if (Number(result.changes) === 0) {
        const current = this.itemById(listId, itemId);
        if (!current) throw new Error('SHOPPING_LIST_ITEM_NOT_FOUND');
        throw new ShoppingConflictError('item', current);
      }
      this.normalizePositions(listId);
      this.touchList(listId, this.#clock().toISOString());
      this.#database.exec('COMMIT');
    } catch (error) {
      this.#database.exec('ROLLBACK');
      throw error;
    }
  }

  bulkMutateItems(
    listId: string,
    selectedItems: readonly Readonly<{ id: string; expectedVersion: number }>[],
    mutation:
      | Readonly<{ type: 'completed'; completed: boolean }>
      | Readonly<{ type: 'store'; storeOverrideId: string | null }>
      | Readonly<{ type: 'delete' }>,
  ): Readonly<{ list: ShoppingListRecord; items: ShoppingListItemRecord[]; affectedItemIds: readonly string[] }> {
    if (selectedItems.length < 1 || selectedItems.length > 500) {
      throw new RangeError('Bulk shopping-list selection must contain between 1 and 500 items');
    }
    const uniqueIds = new Set(selectedItems.map((item) => item.id));
    if (uniqueIds.size !== selectedItems.length) throw new RangeError('Bulk shopping-list selection contains duplicate items');
    selectedItems.forEach((item) => assertVersion(item.expectedVersion));
    if (mutation.type === 'store' && mutation.storeOverrideId) this.assertStoreExists(mutation.storeOverrideId);

    this.#database.exec('BEGIN IMMEDIATE');
    try {
      this.assertListExists(listId);
      const currentItems = selectedItems.map((selected) => {
        const current = this.itemById(listId, selected.id);
        if (!current) throw new Error('SHOPPING_LIST_ITEM_NOT_FOUND');
        if (current.version !== selected.expectedVersion) throw new ShoppingConflictError('item', current);
        return current;
      });
      const timestamp = this.#clock().toISOString();

      if (mutation.type === 'completed') {
        const statement = this.#database.prepare(`
          UPDATE shopping_list_items
          SET completed = ?, completed_at = ?, updated_at = ?, version = version + 1
          WHERE id = ? AND list_id = ? AND version = ?
        `);
        currentItems.forEach((current) => {
          const completedAt = mutation.completed
            ? current.completed && current.completedAt ? current.completedAt : timestamp
            : null;
          statement.run(
            mutation.completed ? 1 : 0,
            completedAt,
            timestamp,
            current.id,
            listId,
            current.version,
          );
        });
      } else if (mutation.type === 'store') {
        const statement = this.#database.prepare(`
          UPDATE shopping_list_items
          SET store_override_id = ?, updated_at = ?, version = version + 1
          WHERE id = ? AND list_id = ? AND version = ?
        `);
        currentItems.forEach((current) => {
          statement.run(mutation.storeOverrideId, timestamp, current.id, listId, current.version);
        });
      } else {
        const statement = this.#database.prepare(
          'DELETE FROM shopping_list_items WHERE id = ? AND list_id = ? AND version = ?',
        );
        currentItems.forEach((current) => statement.run(current.id, listId, current.version));
        this.normalizePositions(listId);
      }

      this.touchList(listId, timestamp);
      const updated = this.getList(listId);
      if (!updated) throw new Error('SHOPPING_LIST_NOT_FOUND');
      this.#database.exec('COMMIT');
      return {
        ...updated,
        affectedItemIds: currentItems.map((item) => item.id),
      };
    } catch (error) {
      this.#database.exec('ROLLBACK');
      throw error;
    }
  }

  reorderItems(listId: string, itemIds: readonly string[], expectedListVersion: number): Readonly<{ list: ShoppingListRecord; items: ShoppingListItemRecord[] }> {
    assertVersion(expectedListVersion);
    this.#database.exec('BEGIN IMMEDIATE');
    try {
      const currentList = this.listById(listId);
      if (!currentList) throw new Error('SHOPPING_LIST_NOT_FOUND');
      if (currentList.version !== expectedListVersion) {
        const current = this.getList(listId);
        if (!current) throw new Error('SHOPPING_LIST_NOT_FOUND');
        throw new ShoppingConflictError('reorder', current);
      }
      const currentIds = (this.#database.prepare('SELECT id FROM shopping_list_items WHERE list_id = ? ORDER BY position, id').all(listId) as Array<{ id: string }>).map((row) => row.id);
      const uniqueIds = new Set(itemIds);
      if (itemIds.length !== currentIds.length || uniqueIds.size !== itemIds.length || currentIds.some((id) => !uniqueIds.has(id))) {
        throw new RangeError('Item order must contain every current item exactly once');
      }
      const timestamp = this.#clock().toISOString();
      const statement = this.#database.prepare('UPDATE shopping_list_items SET position = ?, updated_at = ? WHERE id = ? AND list_id = ?');
      itemIds.forEach((itemId, position) => statement.run(position, timestamp, itemId, listId));
      const listUpdate = this.#database.prepare(`
        UPDATE shopping_lists
        SET updated_at = ?, version = version + 1
        WHERE id = ? AND version = ?
      `).run(timestamp, listId, expectedListVersion);
      if (Number(listUpdate.changes) === 0) {
        const current = this.getList(listId);
        if (!current) throw new Error('SHOPPING_LIST_NOT_FOUND');
        throw new ShoppingConflictError('reorder', current);
      }
      const updated = this.getList(listId);
      if (!updated) throw new Error('SHOPPING_LIST_NOT_FOUND');
      this.#database.exec('COMMIT');
      return updated;
    } catch (error) {
      this.#database.exec('ROLLBACK');
      throw error;
    }
  }

  listVersion(listId: string): number | undefined {
    const row = this.#database.prepare('SELECT version FROM shopping_lists WHERE id = ?').get(listId) as { version: number } | undefined;
    return row?.version;
  }

  private listById(id: string): ShoppingListRecord | undefined {
    const row = this.#database.prepare(`
      SELECT id, name, version, reference_store_id AS referenceStoreId, created_at AS createdAt, updated_at AS updatedAt
      FROM shopping_lists WHERE id = ?
    `).get(id) as ListRow | undefined;
    return row ? mapList(row) : undefined;
  }

  private itemById(listId: string, itemId: string): ShoppingListItemRecord | undefined {
    const row = this.#database.prepare(`
      SELECT
        shopping_list_items.id,
        shopping_list_items.list_id AS listId,
        shopping_list_items.text,
        shopping_list_items.quantity_minor AS quantityMinor,
        shopping_list_items.unit,
        shopping_list_items.exact_required AS exactRequired,
        shopping_list_items.substitution_allowed AS substitutionAllowed,
        shopping_list_items.completed,
        shopping_list_items.completed_at AS completedAt,
        shopping_list_items.position,
        shopping_list_items.version,
        shopping_list_items.product_variant_id AS productVariantId,
        shopping_list_items.store_override_id AS storeOverrideId,
        product_categories.id AS categoryId,
        product_categories.name AS categoryName,
        shopping_list_items.created_at AS createdAt,
        shopping_list_items.updated_at AS updatedAt
      FROM shopping_list_items
      LEFT JOIN product_variants ON product_variants.id = shopping_list_items.product_variant_id
      LEFT JOIN canonical_products ON canonical_products.id = product_variants.canonical_product_id
      LEFT JOIN product_categories ON product_categories.id = canonical_products.category_id
      WHERE shopping_list_items.list_id = ? AND shopping_list_items.id = ?
    `).get(listId, itemId) as ItemRow | undefined;
    return row ? mapItem(row) : undefined;
  }

  private assertListExists(listId: string): void {
    if (!this.#database.prepare('SELECT 1 FROM shopping_lists WHERE id = ?').get(listId)) throw new Error('SHOPPING_LIST_NOT_FOUND');
  }

  private assertProductVariantExists(productVariantId: string): void {
    if (!this.#database.prepare('SELECT 1 FROM product_variants WHERE id = ?').get(productVariantId)) throw new Error('PRODUCT_VARIANT_NOT_FOUND');
  }

  private assertStoreExists(storeId: string): void {
    if (!this.#database.prepare('SELECT 1 FROM stores WHERE id = ?').get(storeId)) throw new Error('STORE_NOT_FOUND');
  }

  private normalizePositions(listId: string): void {
    const ids = (this.#database.prepare('SELECT id FROM shopping_list_items WHERE list_id = ? ORDER BY position, id').all(listId) as Array<{ id: string }>).map((row) => row.id);
    const statement = this.#database.prepare('UPDATE shopping_list_items SET position = ? WHERE id = ? AND list_id = ?');
    ids.forEach((id, position) => statement.run(position, id, listId));
  }

  private touchList(listId: string, timestamp: string): void {
    this.#database.prepare('UPDATE shopping_lists SET updated_at = ?, version = version + 1 WHERE id = ?').run(timestamp, listId);
  }
}

function assertVersion(version: number): void {
  if (!Number.isSafeInteger(version) || version < 1) throw new RangeError('Expected version must be a positive safe integer');
}
