import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, copyFileSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createId } from './ids.ts';

export type ShoppingListRecord = Readonly<{ id: string; name: string; createdAt: string; updatedAt: string }>;
export type ShoppingListItemRecord = Readonly<{
  id: string;
  listId: string;
  text: string;
  quantityMinor: number;
  unit: string;
  exactRequired: boolean;
  substitutionAllowed: boolean;
  position: number;
  createdAt: string;
  updatedAt: string;
}>;

const MIGRATIONS = [
  {
    version: 1,
    sql: `
      CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
      CREATE TABLE retailers(id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL);
      CREATE TABLE stores(id TEXT PRIMARY KEY, retailer_id TEXT NOT NULL REFERENCES retailers(id), name TEXT NOT NULL, region TEXT, created_at TEXT NOT NULL);
      CREATE TABLE canonical_products(id TEXT PRIMARY KEY, name TEXT NOT NULL, category TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE product_variants(id TEXT PRIMARY KEY, canonical_product_id TEXT NOT NULL REFERENCES canonical_products(id), name TEXT NOT NULL, brand TEXT, ean TEXT UNIQUE, package_minor INTEGER, package_unit TEXT, dietary_tags_json TEXT NOT NULL DEFAULT '[]', created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE product_aliases(id TEXT PRIMARY KEY, product_variant_id TEXT NOT NULL REFERENCES product_variants(id), alias TEXT NOT NULL, normalized_alias TEXT NOT NULL, source TEXT NOT NULL, user_confirmed INTEGER NOT NULL CHECK(user_confirmed IN (0,1)), created_at TEXT NOT NULL, UNIQUE(product_variant_id, normalized_alias));
      CREATE VIRTUAL TABLE product_search USING fts5(entity_id UNINDEXED, name, aliases, tokenize='unicode61 remove_diacritics 2');
      CREATE TABLE retailer_listings(id TEXT PRIMARY KEY, retailer_id TEXT NOT NULL REFERENCES retailers(id), product_variant_id TEXT REFERENCES product_variants(id), retailer_sku TEXT, title TEXT NOT NULL, source_url TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(retailer_id, retailer_sku));
      CREATE TABLE external_evidence(id TEXT PRIMARY KEY, source_type TEXT NOT NULL, source_reference TEXT NOT NULL, observed_at TEXT NOT NULL, content_hash TEXT, metadata_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL);
      CREATE TABLE price_observations(id TEXT PRIMARY KEY, retailer_listing_id TEXT REFERENCES retailer_listings(id), retailer_id TEXT NOT NULL REFERENCES retailers(id), store_id TEXT REFERENCES stores(id), price_minor INTEGER NOT NULL CHECK(price_minor >= 0), package_numerator INTEGER NOT NULL CHECK(package_numerator > 0), package_denominator INTEGER NOT NULL CHECK(package_denominator > 0), package_unit TEXT NOT NULL, normalized_price_numerator INTEGER NOT NULL CHECK(normalized_price_numerator >= 0), normalized_price_denominator INTEGER NOT NULL CHECK(normalized_price_denominator > 0), currency TEXT NOT NULL CHECK(currency='EUR'), stock_state TEXT NOT NULL, shipping_minor INTEGER NOT NULL CHECK(shipping_minor >= 0), promotion_json TEXT NOT NULL DEFAULT '{}', conditions_json TEXT NOT NULL DEFAULT '[]', evidence_id TEXT NOT NULL REFERENCES external_evidence(id), observed_at TEXT NOT NULL, confidence REAL NOT NULL CHECK(confidence BETWEEN 0 AND 1), created_at TEXT NOT NULL);
      CREATE INDEX price_observations_listing_observed_idx ON price_observations(retailer_listing_id, observed_at DESC);
      CREATE TABLE receipts(id TEXT PRIMARY KEY, retailer_id TEXT REFERENCES retailers(id), status TEXT NOT NULL, currency TEXT NOT NULL CHECK(currency='EUR'), declared_total_minor INTEGER, import_key TEXT UNIQUE, purchased_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE receipt_captures(id TEXT PRIMARY KEY, receipt_id TEXT NOT NULL REFERENCES receipts(id) ON DELETE CASCADE, position INTEGER NOT NULL, storage_key TEXT, content_hash TEXT, mime_type TEXT NOT NULL, original_name TEXT, created_at TEXT NOT NULL, UNIQUE(receipt_id, position));
      CREATE TABLE receipt_extractions(id TEXT PRIMARY KEY, receipt_id TEXT NOT NULL REFERENCES receipts(id) ON DELETE CASCADE, provider TEXT NOT NULL, original_text TEXT NOT NULL, deterministic_json TEXT NOT NULL, ai_json TEXT, created_at TEXT NOT NULL);
      CREATE TABLE receipt_items(id TEXT PRIMARY KEY, receipt_id TEXT NOT NULL REFERENCES receipts(id) ON DELETE CASCADE, original_description TEXT NOT NULL, normalized_description TEXT, product_variant_id TEXT REFERENCES product_variants(id), quantity INTEGER NOT NULL CHECK(quantity >= 0), unit_price_minor INTEGER NOT NULL CHECK(unit_price_minor >= 0), line_total_minor INTEGER NOT NULL CHECK(line_total_minor >= 0), discount_minor INTEGER NOT NULL DEFAULT 0 CHECK(discount_minor >= 0), status TEXT NOT NULL, confidence REAL NOT NULL CHECK(confidence BETWEEN 0 AND 1), match_reason TEXT, created_at TEXT NOT NULL);
      CREATE TABLE receipt_corrections(id TEXT PRIMARY KEY, receipt_item_id TEXT NOT NULL REFERENCES receipt_items(id) ON DELETE CASCADE, field TEXT NOT NULL, original_json TEXT NOT NULL, corrected_json TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE shopping_lists(id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE shopping_list_items(id TEXT PRIMARY KEY, list_id TEXT NOT NULL REFERENCES shopping_lists(id) ON DELETE CASCADE, text TEXT NOT NULL, quantity_minor INTEGER NOT NULL CHECK(quantity_minor > 0), unit TEXT NOT NULL, exact_required INTEGER NOT NULL CHECK(exact_required IN (0,1)), substitution_allowed INTEGER NOT NULL CHECK(substitution_allowed IN (0,1)), retailer_preferences_json TEXT NOT NULL DEFAULT '[]', position INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE INDEX shopping_list_items_list_position_idx ON shopping_list_items(list_id, position);
      CREATE TABLE optimization_runs(id TEXT PRIMARY KEY, shopping_list_id TEXT REFERENCES shopping_lists(id), input_json TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE optimization_plans(id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES optimization_runs(id) ON DELETE CASCADE, kind TEXT NOT NULL, effective_total_minor INTEGER NOT NULL, retailer_count INTEGER NOT NULL, missing_count INTEGER NOT NULL, confidence REAL NOT NULL, explanation TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE optimization_plan_items(id TEXT PRIMARY KEY, plan_id TEXT NOT NULL REFERENCES optimization_plans(id) ON DELETE CASCADE, shopping_list_item_id TEXT, offer_json TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE ai_provider_configurations(id TEXT PRIMARY KEY, display_name TEXT NOT NULL, base_url TEXT NOT NULL, model TEXT NOT NULL, secret_mask TEXT, capabilities_json TEXT NOT NULL, enabled INTEGER NOT NULL CHECK(enabled IN (0,1)), created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE ai_executions(id TEXT PRIMARY KEY, operation TEXT NOT NULL, provider_id TEXT, status TEXT NOT NULL, attempts INTEGER NOT NULL, duration_ms INTEGER NOT NULL, error_code TEXT, metadata_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL);
      CREATE TABLE ocr_executions(id TEXT PRIMARY KEY, provider TEXT NOT NULL, status TEXT NOT NULL, duration_ms INTEGER NOT NULL, error_code TEXT, metadata_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL);
    `,
  },
] as const;

function now(): string {
  return new Date().toISOString();
}

export class BasketraDatabase {
  readonly #database: DatabaseSync;
  readonly path: string;

  constructor(path: string) {
    this.path = resolve(path);
    mkdirSync(dirname(this.path), { recursive: true });
    this.#database = new DatabaseSync(this.path);
    this.#database.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
    this.migrate();
  }

  migrate(): void {
    const hasMigrations = this.#database.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='schema_migrations'").get();
    const current = hasMigrations ? Number((this.#database.prepare('SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations').get() as { version: number }).version) : 0;
    for (const migration of MIGRATIONS) {
      if (migration.version <= current) continue;
      this.#database.exec('BEGIN IMMEDIATE');
      try {
        this.#database.exec(migration.sql);
        this.#database.prepare('INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)').run(migration.version, now());
        this.#database.exec('COMMIT');
      } catch (error) {
        this.#database.exec('ROLLBACK');
        throw error;
      }
    }
  }

  createShoppingList(name: string): ShoppingListRecord {
    const id = createId('list');
    const timestamp = now();
    this.#database.prepare('INSERT INTO shopping_lists(id, name, created_at, updated_at) VALUES (?, ?, ?, ?)').run(id, name, timestamp, timestamp);
    return { id, name, createdAt: timestamp, updatedAt: timestamp };
  }

  listShoppingLists(): ShoppingListRecord[] {
    return (this.#database.prepare('SELECT id, name, created_at AS createdAt, updated_at AS updatedAt FROM shopping_lists ORDER BY updated_at DESC, id').all() as ShoppingListRecord[]);
  }

  getShoppingList(id: string): Readonly<{ list: ShoppingListRecord; items: ShoppingListItemRecord[] }> | undefined {
    const list = this.#database.prepare('SELECT id, name, created_at AS createdAt, updated_at AS updatedAt FROM shopping_lists WHERE id = ?').get(id) as ShoppingListRecord | undefined;
    if (!list) return undefined;
    const rows = this.#database.prepare(`SELECT id, list_id AS listId, text, quantity_minor AS quantityMinor, unit, exact_required AS exactRequired, substitution_allowed AS substitutionAllowed, position, created_at AS createdAt, updated_at AS updatedAt FROM shopping_list_items WHERE list_id = ? ORDER BY position, id`).all(id) as Array<Omit<ShoppingListItemRecord, 'exactRequired' | 'substitutionAllowed'> & { exactRequired: number; substitutionAllowed: number }>;
    return { list, items: rows.map((row) => ({ ...row, exactRequired: row.exactRequired === 1, substitutionAllowed: row.substitutionAllowed === 1 })) };
  }

  addShoppingListItem(input: Readonly<{ listId: string; text: string; quantityMinor: number; unit: string; exactRequired: boolean; substitutionAllowed: boolean }>): ShoppingListItemRecord {
    const exists = this.#database.prepare('SELECT 1 FROM shopping_lists WHERE id = ?').get(input.listId);
    if (!exists) throw new Error('SHOPPING_LIST_NOT_FOUND');
    const position = Number((this.#database.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS position FROM shopping_list_items WHERE list_id = ?').get(input.listId) as { position: number }).position);
    const id = createId('item');
    const timestamp = now();
    this.#database.prepare(`INSERT INTO shopping_list_items(id, list_id, text, quantity_minor, unit, exact_required, substitution_allowed, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, input.listId, input.text, input.quantityMinor, input.unit, input.exactRequired ? 1 : 0, input.substitutionAllowed ? 1 : 0, position, timestamp, timestamp);
    this.#database.prepare('UPDATE shopping_lists SET updated_at = ? WHERE id = ?').run(timestamp, input.listId);
    return { id, listId: input.listId, text: input.text, quantityMinor: input.quantityMinor, unit: input.unit, exactRequired: input.exactRequired, substitutionAllowed: input.substitutionAllowed, position, createdAt: timestamp, updatedAt: timestamp };
  }

  searchProducts(query: string, limit: number): Array<Readonly<{ id: string; name: string; source: string }>> {
    const normalized = query.trim().replace(/["*:^()]/g, ' ');
    if (!normalized) return [];
    return this.#database.prepare(`SELECT entity_id AS id, name, 'catalog' AS source FROM product_search WHERE product_search MATCH ? ORDER BY bm25(product_search) LIMIT ?`).all(`${normalized}*`, limit) as Array<Readonly<{ id: string; name: string; source: string }>>;
  }

  seedProduct(input: Readonly<{ name: string; brand?: string; aliases?: readonly string[] }>): string {
    const productId = createId('product');
    const variantId = createId('variant');
    const timestamp = now();
    this.#database.exec('BEGIN IMMEDIATE');
    try {
      this.#database.prepare('INSERT INTO canonical_products(id, name, created_at, updated_at) VALUES (?, ?, ?, ?)').run(productId, input.name, timestamp, timestamp);
      this.#database.prepare('INSERT INTO product_variants(id, canonical_product_id, name, brand, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(variantId, productId, input.name, input.brand ?? null, timestamp, timestamp);
      const aliases = input.aliases ?? [];
      for (const alias of aliases) {
        this.#database.prepare('INSERT INTO product_aliases(id, product_variant_id, alias, normalized_alias, source, user_confirmed, created_at) VALUES (?, ?, ?, ?, ?, 1, ?)').run(createId('alias'), variantId, alias, alias.toLowerCase(), 'seed', timestamp);
      }
      this.#database.prepare('INSERT INTO product_search(entity_id, name, aliases) VALUES (?, ?, ?)').run(variantId, [input.brand, input.name].filter(Boolean).join(' '), aliases.join(' '));
      this.#database.exec('COMMIT');
      return variantId;
    } catch (error) {
      this.#database.exec('ROLLBACK');
      throw error;
    }
  }

  importReceipt(input: Readonly<{ importKey: string; declaredTotalMinor: number; originalText: string; items: readonly Readonly<{ description: string; quantity: number; unitPriceMinor: number; lineTotalMinor: number; status: string; confidence: number }>[] }>): string {
    const existing = this.#database.prepare('SELECT id FROM receipts WHERE import_key = ?').get(input.importKey) as { id: string } | undefined;
    if (existing) return existing.id;
    const receiptId = createId('receipt');
    const timestamp = now();
    this.#database.exec('BEGIN IMMEDIATE');
    try {
      this.#database.prepare('INSERT INTO receipts(id, status, currency, declared_total_minor, import_key, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(receiptId, 'confirmed', 'EUR', input.declaredTotalMinor, input.importKey, timestamp, timestamp);
      this.#database.prepare('INSERT INTO receipt_extractions(id, receipt_id, provider, original_text, deterministic_json, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(createId('extraction'), receiptId, 'manual-or-embedded', input.originalText, JSON.stringify(input.items), timestamp);
      for (const item of input.items) {
        this.#database.prepare(`INSERT INTO receipt_items(id, receipt_id, original_description, quantity, unit_price_minor, line_total_minor, status, confidence, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(createId('receiptitem'), receiptId, item.description, item.quantity, item.unitPriceMinor, item.lineTotalMinor, item.status, item.confidence, timestamp);
      }
      this.#database.exec('COMMIT');
      return receiptId;
    } catch (error) {
      this.#database.exec('ROLLBACK');
      throw error;
    }
  }

  backup(destination: string): Readonly<{ path: string; bytes: number }> {
    this.#database.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    const target = resolve(destination);
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(this.path, target);
    return { path: target, bytes: statSync(target).size };
  }

  close(): void {
    this.#database.close();
  }
}

export function validateBackup(path: string): Readonly<{ valid: boolean; version: number }> {
  const database = new DatabaseSync(resolve(path), { readOnly: true });
  try {
    const integrity = database.prepare('PRAGMA integrity_check').get() as { integrity_check: string };
    const versionRow = database.prepare("SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations").get() as { version: number };
    return { valid: integrity.integrity_check === 'ok', version: Number(versionRow.version) };
  } finally {
    database.close();
  }
}
