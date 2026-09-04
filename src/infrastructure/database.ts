import { DatabaseSync } from 'node:sqlite';
import { copyFileSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { UNKNOWN_CATEGORY_NAME } from '../domain/categories.ts';
import type { GeoPointMicrodegrees } from '../domain/location.ts';
import type { Unit } from '../domain/units.ts';
import { CatalogRepository } from './catalog-repository.ts';
import { COLLABORATION_MIGRATIONS } from './collaboration-schema.ts';
import { createId } from './ids.ts';
import { ShoppingRepository } from './shopping-repository.ts';

export type {
  PriceObservationRecord,
  ProductTicketHistoryRecord,
  ProductCategoryRecord,
  ProductSuggestionRecord,
  ProductVariantRecord,
  StoreRecord,
} from './catalog-repository.ts';
export {
  ShoppingConflictError,
  type ShoppingListItemRecord,
  type ShoppingListRecord,
  type ShoppingListSummaryRecord,
} from './shopping-repository.ts';

export type RetailerSuggestion = Readonly<{
  id: string;
  name: string;
  receiptCount: number;
  lastUsedAt?: string;
}>;

export const RECEIPT_EXTRACTION_JOB_STATUSES = ['queued', 'running', 'completed', 'failed', 'cancelled'] as const;
export type ReceiptExtractionJobStatus = typeof RECEIPT_EXTRACTION_JOB_STATUSES[number];

export type ReceiptExtractionJobRecord = Readonly<{
  id: string;
  status: ReceiptExtractionJobStatus;
  input: unknown;
  result?: unknown;
  errorCode?: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}>;

export type ReceiptImportInput = Readonly<{
  importKey: string;
  declaredTotalMinor: number;
  originalText: string;
  provider: string;
  retailerName?: string;
  storeId?: string;
  storeName?: string;
  deterministic: unknown;
  ai?: unknown;
  captures?: readonly Readonly<{ storageKey: string; contentHash?: string; mimeType: string; originalName?: string }>[];
  items: readonly Readonly<{
    description: string;
    quantity: number;
    unitPriceMinor: number;
    lineTotalMinor: number;
    discountMinor?: number;
    categoryId?: string;
    status: string;
    confidence: number;
  }>[];
  corrections?: readonly Readonly<{ itemIndex: number; field: string; original: unknown; corrected: unknown }>[];
}>;

export type MigrationDefinition = Readonly<{
  version: number;
  kind: 'safe' | 'destructive';
  sql: string;
}>;

export type BackupRetentionPolicy = Readonly<{
  maxCount: number;
  maxBytes: number;
}>;

export type BasketraDatabaseOptions = Readonly<{
  additionalMigrations?: readonly MigrationDefinition[];
  allowDestructiveMigrations?: boolean;
  migrationBackupDir?: string;
  clock?: () => Date;
  maxDatabaseBytes?: number;
  maxSqliteCacheBytes?: number;
  maxWalBytes?: number;
  migrationBackupRetention?: BackupRetentionPolicy;
  manualBackupRetention?: BackupRetentionPolicy;
}>;

export const DEFAULT_DATABASE_STORAGE_LIMITS = Object.freeze({
  maxDatabaseBytes: 512 * 1024 * 1024,
  maxSqliteCacheBytes: 8 * 1024 * 1024,
  maxWalBytes: 16 * 1024 * 1024,
  migrationBackupRetention: Object.freeze({ maxCount: 3, maxBytes: 768 * 1024 * 1024 }),
  manualBackupRetention: Object.freeze({ maxCount: 5, maxBytes: 768 * 1024 * 1024 }),
});

const BASE_MIGRATIONS: readonly MigrationDefinition[] = [
  {
    version: 1,
    kind: 'safe',
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
  {
    version: 2,
    kind: 'safe',
    sql: `
      CREATE TABLE schema_migration_backups(
        backup_name TEXT PRIMARY KEY,
        from_version INTEGER NOT NULL CHECK(from_version >= 0),
        to_version INTEGER NOT NULL CHECK(to_version > from_version),
        bytes INTEGER NOT NULL CHECK(bytes > 0),
        created_at TEXT NOT NULL
      );
    `,
  },
  {
    version: 3,
    kind: 'safe',
    sql: `
      ALTER TABLE shopping_list_items ADD COLUMN completed INTEGER NOT NULL DEFAULT 0 CHECK(completed IN (0,1));
      ALTER TABLE shopping_list_items ADD COLUMN completed_at TEXT;
    `,
  },
] as const;

const MIGRATIONS: readonly MigrationDefinition[] = [...BASE_MIGRATIONS, ...COLLABORATION_MIGRATIONS];
export const CURRENT_SCHEMA_VERSION = MIGRATIONS.at(-1)?.version ?? 0;

const DESTRUCTIVE_SQL = /\b(?:DROP\s+(?:TABLE|INDEX|VIEW|TRIGGER)|ALTER\s+TABLE\s+\S+\s+DROP\s+COLUMN|DELETE\s+FROM|TRUNCATE)\b/i;

type BackupEntry = Readonly<{ name: string; path: string; bytes: number; mtimeMs: number }>;

function escapeLikePrefix(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_');
}

function assertPositiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new RangeError(`${name} must be a positive safe integer`);
  return value;
}

function assertRetentionPolicy(policy: BackupRetentionPolicy, name: string): BackupRetentionPolicy {
  return {
    maxCount: assertPositiveInteger(policy.maxCount, `${name}.maxCount`),
    maxBytes: assertPositiveInteger(policy.maxBytes, `${name}.maxBytes`),
  };
}

function schemaVersion(database: DatabaseSync): number {
  const hasMigrations = database.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='schema_migrations'").get();
  if (!hasMigrations) return 0;
  const row = database.prepare('SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations').get() as { version: number };
  return Number(row.version);
}

function integrityIsValid(database: DatabaseSync): boolean {
  const integrity = database.prepare('PRAGMA integrity_check').get() as { integrity_check: string };
  return integrity.integrity_check === 'ok';
}

function createPortableBackup(source: string, destination: string): number {
  const temporary = `${destination}.${createId('partial')}.tmp`;
  try {
    copyFileSync(source, temporary);
    const backup = new DatabaseSync(temporary);
    try {
      backup.exec('PRAGMA journal_mode = DELETE;');
    } finally {
      backup.close();
    }
    const bytes = statSync(temporary).size;
    renameSync(temporary, destination);
    return bytes;
  } finally {
    rmSync(temporary, { force: true });
  }
}

function listBackupFiles(directory: string, ignoredNames: ReadonlySet<string> = new Set()): BackupEntry[] {
  mkdirSync(directory, { recursive: true });
  return readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.db') && !ignoredNames.has(entry.name))
    .map((entry) => {
      const path = join(directory, entry.name);
      const stat = statSync(path);
      return { name: entry.name, path, bytes: stat.size, mtimeMs: stat.mtimeMs };
    })
    .sort((left, right) => right.mtimeMs - left.mtimeMs || right.name.localeCompare(left.name));
}

function pruneBackupDirectory(
  directory: string,
  policy: BackupRetentionPolicy,
  options: Readonly<{
    protectedNames?: ReadonlySet<string>;
    ignoredNames?: ReadonlySet<string>;
    reserveCount?: number;
    reserveBytes?: number;
  }> = {},
): string[] {
  const protectedNames = options.protectedNames ?? new Set<string>();
  let usedCount = options.reserveCount ?? 0;
  let usedBytes = options.reserveBytes ?? 0;
  if (usedCount > policy.maxCount || usedBytes > policy.maxBytes) {
    throw new Error('Backup retention budget cannot fit the required backup');
  }

  const entries = listBackupFiles(directory, options.ignoredNames).sort((left, right) => {
    const protectedOrder = Number(protectedNames.has(right.name)) - Number(protectedNames.has(left.name));
    return protectedOrder || right.mtimeMs - left.mtimeMs || right.name.localeCompare(left.name);
  });
  const removed: string[] = [];
  for (const entry of entries) {
    const fits = usedCount + 1 <= policy.maxCount && usedBytes + entry.bytes <= policy.maxBytes;
    if (protectedNames.has(entry.name) && !fits) {
      throw new Error(`Protected backup ${entry.name} exceeds the configured retention budget`);
    }
    if (fits) {
      usedCount += 1;
      usedBytes += entry.bytes;
      continue;
    }
    rmSync(entry.path, { force: true });
    removed.push(entry.name);
  }
  return removed;
}

function prepareMigrations(additionalMigrations: readonly MigrationDefinition[]): readonly MigrationDefinition[] {
  const migrations = [...MIGRATIONS, ...additionalMigrations].sort((left, right) => left.version - right.version);
  for (const [index, migration] of migrations.entries()) {
    const expectedVersion = index + 1;
    if (!Number.isSafeInteger(migration.version) || migration.version !== expectedVersion) {
      throw new Error(`Migration versions must be contiguous from 1; expected ${expectedVersion}`);
    }
    if (!migration.sql.trim()) throw new Error(`Migration ${migration.version} must contain SQL`);
  }
  return migrations;
}

function assertMigrationSafety(migrations: readonly MigrationDefinition[], allowDestructiveMigrations: boolean): void {
  for (const migration of migrations) {
    const containsDestructiveSql = DESTRUCTIVE_SQL.test(migration.sql);
    if (migration.kind === 'safe' && containsDestructiveSql) {
      throw new Error(`Migration ${migration.version} contains destructive SQL but is marked safe`);
    }
    if (migration.kind === 'destructive' && !allowDestructiveMigrations) {
      throw new Error(`Migration ${migration.version} is destructive and requires explicit authorization`);
    }
  }
}

export class BasketraDatabase {
  readonly #database: DatabaseSync;
  readonly #migrations: readonly MigrationDefinition[];
  readonly #allowDestructiveMigrations: boolean;
  readonly #migrationBackupDir: string;
  readonly #clock: () => Date;
  readonly #maxDatabaseBytes: number;
  readonly #maxSqliteCacheBytes: number;
  readonly #maxWalBytes: number;
  readonly #migrationBackupRetention: BackupRetentionPolicy;
  readonly #manualBackupRetention: BackupRetentionPolicy;
  readonly #shopping: ShoppingRepository;
  readonly #catalog: CatalogRepository;
  readonly path: string;

  constructor(path: string, options: BasketraDatabaseOptions = {}) {
    this.path = resolve(path);
    this.#migrations = prepareMigrations(options.additionalMigrations ?? []);
    this.#allowDestructiveMigrations = options.allowDestructiveMigrations ?? false;
    this.#migrationBackupDir = resolve(options.migrationBackupDir ?? join(dirname(this.path), 'backups', 'migrations'));
    this.#clock = options.clock ?? (() => new Date());
    this.#maxDatabaseBytes = assertPositiveInteger(options.maxDatabaseBytes ?? DEFAULT_DATABASE_STORAGE_LIMITS.maxDatabaseBytes, 'maxDatabaseBytes');
    this.#maxSqliteCacheBytes = assertPositiveInteger(options.maxSqliteCacheBytes ?? DEFAULT_DATABASE_STORAGE_LIMITS.maxSqliteCacheBytes, 'maxSqliteCacheBytes');
    this.#maxWalBytes = assertPositiveInteger(options.maxWalBytes ?? DEFAULT_DATABASE_STORAGE_LIMITS.maxWalBytes, 'maxWalBytes');
    this.#migrationBackupRetention = assertRetentionPolicy(options.migrationBackupRetention ?? DEFAULT_DATABASE_STORAGE_LIMITS.migrationBackupRetention, 'migrationBackupRetention');
    this.#manualBackupRetention = assertRetentionPolicy(options.manualBackupRetention ?? DEFAULT_DATABASE_STORAGE_LIMITS.manualBackupRetention, 'manualBackupRetention');
    mkdirSync(dirname(this.path), { recursive: true });
    this.#database = new DatabaseSync(this.path);
    try {
      this.#database.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000; PRAGMA wal_autocheckpoint = 256;');
      this.configureStorageLimits();
      this.migrate();
    } catch (error) {
      this.#database.close();
      throw error;
    }
    this.#shopping = new ShoppingRepository(this.#database, this.#clock);
    this.#catalog = new CatalogRepository(this.#database, this.#clock);
  }

  private configureStorageLimits(): void {
    const pageSize = Number((this.#database.prepare('PRAGMA page_size').get() as { page_size: number }).page_size);
    const maxPageCount = Math.floor(this.#maxDatabaseBytes / pageSize);
    if (maxPageCount < 1) throw new RangeError('maxDatabaseBytes must fit at least one SQLite page');
    const cacheKibibytes = Math.max(1, Math.floor(this.#maxSqliteCacheBytes / 1024));
    this.#database.exec(`PRAGMA max_page_count = ${maxPageCount}; PRAGMA cache_size = -${cacheKibibytes}; PRAGMA journal_size_limit = ${this.#maxWalBytes};`);
    const effectiveMaxPageCount = Number((this.#database.prepare('PRAGMA max_page_count').get() as { max_page_count: number }).max_page_count);
    if (effectiveMaxPageCount > maxPageCount) throw new Error('Existing database exceeds the configured maximum database size');
  }

  storageLimits(): Readonly<{ pageSize: number; maxPageCount: number; maxDatabaseBytes: number; cacheBytes: number; walBytes: number }> {
    const pageSize = Number((this.#database.prepare('PRAGMA page_size').get() as { page_size: number }).page_size);
    const maxPageCount = Number((this.#database.prepare('PRAGMA max_page_count').get() as { max_page_count: number }).max_page_count);
    const cacheSize = Number((this.#database.prepare('PRAGMA cache_size').get() as { cache_size: number }).cache_size);
    const journalSizeLimit = Number((this.#database.prepare('PRAGMA journal_size_limit').get() as { journal_size_limit: number }).journal_size_limit);
    return {
      pageSize,
      maxPageCount,
      maxDatabaseBytes: pageSize * maxPageCount,
      cacheBytes: Math.abs(cacheSize) * 1024,
      walBytes: journalSizeLimit,
    };
  }

  migrate(): void {
    const currentVersion = schemaVersion(this.#database);
    const pendingMigrations = this.#migrations.filter((migration) => migration.version > currentVersion);
    if (pendingMigrations.length === 0) {
      this.pruneMigrationBackups();
      return;
    }

    assertMigrationSafety(pendingMigrations, this.#allowDestructiveMigrations);
    const targetVersion = pendingMigrations.at(-1)?.version;
    if (targetVersion === undefined) return;

    const migrationBackup = this.createPreMigrationBackup(currentVersion, targetVersion);
    this.#database.exec('BEGIN IMMEDIATE');
    try {
      for (const migration of pendingMigrations) {
        this.#database.exec(migration.sql);
        this.#database.prepare('INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)').run(migration.version, this.#clock().toISOString());
      }
      if (targetVersion >= 2) {
        this.#database.prepare('INSERT INTO schema_migration_backups(backup_name, from_version, to_version, bytes, created_at) VALUES (?, ?, ?, ?, ?)').run(
          migrationBackup.name,
          currentVersion,
          targetVersion,
          migrationBackup.bytes,
          migrationBackup.createdAt,
        );
      }
      if (!integrityIsValid(this.#database)) throw new Error('Database integrity check failed after migrations');
      if (schemaVersion(this.#database) !== targetVersion) throw new Error('Database schema version did not reach migration target');
      this.#database.exec('COMMIT');
      this.pruneMigrationBackups(new Set([migrationBackup.name]));
    } catch (error) {
      this.#database.exec('ROLLBACK');
      try {
        this.pruneMigrationBackups(new Set([migrationBackup.name]));
      } catch (cleanupError) {
        throw new AggregateError([error, cleanupError], 'Migration failed and backup retention cleanup also failed');
      }
      throw error;
    }
  }

  private pruneMigrationBackups(
    protectedNames: ReadonlySet<string> = new Set(),
    reserveCount = 0,
    reserveBytes = 0,
  ): void {
    const removed = pruneBackupDirectory(this.#migrationBackupDir, this.#migrationBackupRetention, {
      protectedNames,
      reserveCount,
      reserveBytes,
    });
    if (removed.length === 0) return;
    const hasAuditTable = this.#database.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='schema_migration_backups'").get();
    if (!hasAuditTable) return;
    const statement = this.#database.prepare('DELETE FROM schema_migration_backups WHERE backup_name = ?');
    for (const name of removed) statement.run(name);
  }

  private createPreMigrationBackup(fromVersion: number, toVersion: number): Readonly<{ name: string; bytes: number; createdAt: string }> {
    this.#database.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    mkdirSync(this.#migrationBackupDir, { recursive: true });
    const sourceBytes = statSync(this.path).size;
    this.pruneMigrationBackups(new Set(), 1, sourceBytes);
    const createdAt = this.#clock().toISOString();
    const backupName = `basketra-pre-migration-v${fromVersion}-to-v${toVersion}-${createId('backup')}.db`;
    const backupPath = join(this.#migrationBackupDir, backupName);
    try {
      const bytes = createPortableBackup(this.path, backupPath);
      if (bytes > this.#migrationBackupRetention.maxBytes) throw new Error('Pre-migration backup exceeds the configured retention byte budget');
      const validation = validateBackup(backupPath);
      if (!validation.valid || validation.version !== fromVersion) throw new Error('Pre-migration backup validation failed');
      this.pruneMigrationBackups(new Set([backupName]));
      return { name: backupName, bytes, createdAt };
    } catch (error) {
      rmSync(backupPath, { force: true });
      throw error;
    }
  }

  createShoppingList(name: string) {
    return this.#shopping.createList(name);
  }

  listShoppingLists() {
    return this.#shopping.listLists();
  }

  getShoppingList(id: string) {
    return this.#shopping.getList(id);
  }

  updateShoppingList(id: string, name: string, expectedVersion: number) {
    return this.#shopping.updateList(id, name, expectedVersion);
  }

  deleteShoppingList(id: string, expectedVersion: number): boolean {
    return this.#shopping.deleteList(id, expectedVersion);
  }

  addShoppingListItem(input: Readonly<{
    listId: string;
    text: string;
    quantityMinor: number;
    unit: string;
    exactRequired: boolean;
    substitutionAllowed: boolean;
    productVariantId?: string;
  }>) {
    return this.#shopping.addItem(input);
  }

  updateShoppingListItem(input: Readonly<{
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
  }>) {
    return this.#shopping.updateItem(input);
  }

  deleteShoppingListItem(listId: string, itemId: string, expectedVersion: number): void {
    this.#shopping.deleteItem(listId, itemId, expectedVersion);
  }

  reorderShoppingListItems(listId: string, itemIds: readonly string[], expectedListVersion: number) {
    return this.#shopping.reorderItems(listId, itemIds, expectedListVersion);
  }

  getShoppingListVersion(listId: string): number | undefined {
    return this.#shopping.listVersion(listId);
  }

  listCategories() {
    return this.#catalog.listCategories();
  }

  getOrCreateCategory(name: string, description?: string) {
    return this.#catalog.getOrCreateCategory(name, description);
  }

  updateCategory(id: string, input: Readonly<{ name: string; description?: string | null }>) {
    return this.#catalog.updateCategory(id, input);
  }

  searchProducts(query: string, limit: number) {
    return this.#catalog.searchProducts(query, limit);
  }

  getProductVariant(id: string) {
    return this.#catalog.getProductVariant(id);
  }

  createProduct(input: Readonly<{
    canonicalName: string;
    variantName?: string;
    categoryId?: string;
    description?: string;
    brand?: string;
    ean?: string;
    packageMinor?: number;
    packageUnit?: string;
    aliases?: readonly string[];
  }>) {
    return this.#catalog.createProduct(input);
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
  }>) {
    return this.#catalog.updateProduct(input);
  }

  listStores(origin?: GeoPointMicrodegrees, maximumDistanceMeters?: number, limit?: number) {
    return this.#catalog.listStores(origin, maximumDistanceMeters, limit);
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
  }>) {
    return this.#catalog.saveStore(input);
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
  }>) {
    return this.#catalog.confirmPriceObservation(input);
  }

  listPriceObservations(productVariantId: string) {
    return this.#catalog.listPriceObservations(productVariantId);
  }

  listProductTicketHistory(productVariantId: string) {
    return this.#catalog.listProductTicketHistory(productVariantId);
  }

  searchRetailers(query: string, limit: number): RetailerSuggestion[] {
    const normalized = query.trim();
    if (!normalized) return [];
    const rows = this.#database.prepare(`
      SELECT
        retailers.id,
        retailers.name,
        COUNT(receipts.id) AS receiptCount,
        MAX(receipts.created_at) AS lastUsedAt
      FROM retailers
      LEFT JOIN receipts ON receipts.retailer_id = retailers.id
      WHERE retailers.name LIKE ? ESCAPE '\\' COLLATE NOCASE
      GROUP BY retailers.id, retailers.name
      ORDER BY receiptCount DESC, lastUsedAt DESC, retailers.name COLLATE NOCASE
      LIMIT ?
    `).all(`${escapeLikePrefix(normalized)}%`, limit) as Array<{
      id: string;
      name: string;
      receiptCount: number;
      lastUsedAt: string | null;
    }>;
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      receiptCount: Number(row.receiptCount),
      ...(row.lastUsedAt ? { lastUsedAt: row.lastUsedAt } : {}),
    }));
  }

  createReceiptExtractionJob(input: unknown): ReceiptExtractionJobRecord {
    const id = createId('receiptextractionjob');
    const timestamp = this.#clock().toISOString();
    this.#database.prepare(`
      INSERT INTO receipt_extraction_jobs(id, status, input_json, created_at, updated_at)
      VALUES (?, 'queued', ?, ?, ?)
    `).run(id, JSON.stringify(input), timestamp, timestamp);
    return this.getReceiptExtractionJob(id)!;
  }

  getReceiptExtractionJob(id: string): ReceiptExtractionJobRecord | undefined {
    const row = this.#database.prepare(`
      SELECT id, status, input_json AS inputJson, result_json AS resultJson, error_code AS errorCode,
        created_at AS createdAt, updated_at AS updatedAt, completed_at AS completedAt
      FROM receipt_extraction_jobs WHERE id = ?
    `).get(id) as {
      id: string;
      status: ReceiptExtractionJobStatus;
      inputJson: string;
      resultJson: string | null;
      errorCode: string | null;
      createdAt: string;
      updatedAt: string;
      completedAt: string | null;
    } | undefined;
    if (!row) return undefined;
    return {
      id: row.id,
      status: row.status,
      input: JSON.parse(row.inputJson) as unknown,
      ...(row.resultJson === null ? {} : { result: JSON.parse(row.resultJson) as unknown }),
      ...(row.errorCode === null ? {} : { errorCode: row.errorCode }),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      ...(row.completedAt === null ? {} : { completedAt: row.completedAt }),
    };
  }

  startReceiptExtractionJob(id: string): ReceiptExtractionJobRecord | undefined {
    const timestamp = this.#clock().toISOString();
    this.#database.prepare(`
      UPDATE receipt_extraction_jobs SET status = 'running', updated_at = ?
      WHERE id = ? AND status = 'queued'
    `).run(timestamp, id);
    const job = this.getReceiptExtractionJob(id);
    return job?.status === 'running' ? job : undefined;
  }

  completeReceiptExtractionJob(id: string, result: unknown): ReceiptExtractionJobRecord | undefined {
    const timestamp = this.#clock().toISOString();
    this.#database.prepare(`
      UPDATE receipt_extraction_jobs
      SET status = 'completed', result_json = ?, error_code = NULL, updated_at = ?, completed_at = ?
      WHERE id = ? AND status = 'running'
    `).run(JSON.stringify(result), timestamp, timestamp, id);
    return this.getReceiptExtractionJob(id);
  }

  failReceiptExtractionJob(id: string, errorCode: string): ReceiptExtractionJobRecord | undefined {
    const timestamp = this.#clock().toISOString();
    this.#database.prepare(`
      UPDATE receipt_extraction_jobs
      SET status = 'failed', error_code = ?, updated_at = ?, completed_at = ?
      WHERE id = ? AND status = 'running'
    `).run(errorCode, timestamp, timestamp, id);
    return this.getReceiptExtractionJob(id);
  }

  cancelReceiptExtractionJob(id: string): ReceiptExtractionJobRecord | undefined {
    const timestamp = this.#clock().toISOString();
    this.#database.prepare(`
      UPDATE receipt_extraction_jobs
      SET status = 'cancelled', updated_at = ?, completed_at = ?
      WHERE id = ? AND status IN ('queued', 'running')
    `).run(timestamp, timestamp, id);
    return this.getReceiptExtractionJob(id);
  }

  recoverInterruptedReceiptExtractionJobs(): number {
    const timestamp = this.#clock().toISOString();
    const result = this.#database.prepare(`
      UPDATE receipt_extraction_jobs
      SET status = 'failed', error_code = 'RECEIPT_EXTRACTION_INTERRUPTED', updated_at = ?, completed_at = ?
      WHERE status IN ('queued', 'running')
    `).run(timestamp, timestamp);
    return Number(result.changes);
  }

  pruneReceiptExtractionJobs(before: string): number {
    const result = this.#database.prepare('DELETE FROM receipt_extraction_jobs WHERE updated_at < ?').run(before);
    return Number(result.changes);
  }

  seedProduct(input: Readonly<{ name: string; brand?: string; aliases?: readonly string[] }>): string {
    return this.#catalog.createProduct({
      canonicalName: input.name,
      variantName: input.name,
      ...(input.brand ? { brand: input.brand } : {}),
      ...(input.aliases ? { aliases: input.aliases } : {}),
    }).id;
  }

  importReceipt(input: ReceiptImportInput): string {
    const existing = this.#database.prepare('SELECT id FROM receipts WHERE import_key = ?').get(input.importKey) as { id: string } | undefined;
    if (existing) return existing.id;
    const receiptId = createId('receipt');
    const timestamp = this.#clock().toISOString();
    this.#database.exec('BEGIN IMMEDIATE');
    try {
      const fallbackCategory = this.#database.prepare(`
        SELECT id FROM product_categories WHERE name = ? COLLATE NOCASE LIMIT 1
      `).get(UNKNOWN_CATEGORY_NAME) as { id: string } | undefined;
      if (!fallbackCategory) throw new Error('UNKNOWN_CATEGORY_NOT_AVAILABLE');

      let retailerId: string | null = null;
      if (input.retailerName) {
        const existingRetailer = this.#database.prepare('SELECT id FROM retailers WHERE name = ? COLLATE NOCASE').get(input.retailerName) as { id: string } | undefined;
        retailerId = existingRetailer?.id ?? createId('retailer');
        if (!existingRetailer) {
          this.#database.prepare('INSERT INTO retailers(id, name, created_at) VALUES (?, ?, ?)').run(retailerId, input.retailerName, timestamp);
        }
      }
      let storeId: string | null = null;
      if (input.storeId) {
        const store = this.#database.prepare(`
          SELECT id, retailer_id AS retailerId, name FROM stores WHERE id = ?
        `).get(input.storeId) as { id: string; retailerId: string; name: string } | undefined;
        if (!store) throw new Error('RECEIPT_STORE_NOT_FOUND');
        if (retailerId && retailerId !== store.retailerId) throw new Error('RECEIPT_STORE_RETAILER_MISMATCH');
        if (input.storeName && input.storeName.localeCompare(store.name, 'es', { sensitivity: 'accent' }) !== 0) {
          throw new Error('RECEIPT_STORE_NAME_MISMATCH');
        }
        retailerId = store.retailerId;
        storeId = store.id;
      } else if (input.storeName) {
        if (!retailerId) throw new Error('RECEIPT_STORE_RETAILER_REQUIRED');
        const existingStore = this.#database.prepare(`
          SELECT id FROM stores WHERE retailer_id = ? AND name = ? COLLATE NOCASE ORDER BY id LIMIT 1
        `).get(retailerId, input.storeName) as { id: string } | undefined;
        storeId = existingStore?.id ?? createId('store');
        if (!existingStore) {
          this.#database.prepare('INSERT INTO stores(id, retailer_id, name, created_at) VALUES (?, ?, ?, ?)')
            .run(storeId, retailerId, input.storeName, timestamp);
        }
      }
      this.#database.prepare('INSERT INTO receipts(id, retailer_id, store_id, status, currency, declared_total_minor, import_key, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(receiptId, retailerId, storeId, 'confirmed', 'EUR', input.declaredTotalMinor, input.importKey, timestamp, timestamp);
      for (const [position, capture] of (input.captures ?? []).entries()) {
        this.#database.prepare('INSERT INTO receipt_captures(id, receipt_id, position, storage_key, content_hash, mime_type, original_name, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(createId('capture'), receiptId, position, capture.storageKey, capture.contentHash ?? null, capture.mimeType, capture.originalName ?? null, timestamp);
      }
      this.#database.prepare('INSERT INTO receipt_extractions(id, receipt_id, provider, original_text, deterministic_json, ai_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(createId('extraction'), receiptId, input.provider, input.originalText, JSON.stringify(input.deterministic), input.ai === undefined ? null : JSON.stringify(input.ai), timestamp);
      const itemIds: string[] = [];
      for (const item of input.items) {
        const itemId = createId('receiptitem');
        itemIds.push(itemId);
        const requestedCategory = item.categoryId
          ? this.#database.prepare('SELECT id FROM product_categories WHERE id = ?').get(item.categoryId) as { id: string } | undefined
          : undefined;
        const initialCategoryId = requestedCategory?.id ?? fallbackCategory.id;
        this.#database.prepare(`
          INSERT INTO receipt_items(
            id, receipt_id, original_description, quantity, unit_price_minor, line_total_minor,
            discount_minor, category_id, status, confidence, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          itemId,
          receiptId,
          item.description,
          item.quantity,
          item.unitPriceMinor,
          item.lineTotalMinor,
          item.discountMinor ?? 0,
          initialCategoryId,
          item.status,
          item.confidence,
          timestamp,
        );

        const linkedCategory = this.#database.prepare(`
          SELECT canonical_products.category_id AS categoryId
          FROM receipt_items
          JOIN product_variants ON product_variants.id = receipt_items.product_variant_id
          JOIN canonical_products ON canonical_products.id = product_variants.canonical_product_id
          WHERE receipt_items.id = ?
        `).get(itemId) as { categoryId: string | null } | undefined;
        if (linkedCategory?.categoryId) {
          this.#database.prepare('UPDATE receipt_items SET category_id = ? WHERE id = ?').run(linkedCategory.categoryId, itemId);
        } else {
          this.#database.prepare(`
            UPDATE canonical_products
            SET category_id = ?,
                category = (SELECT name FROM product_categories WHERE id = ?),
                updated_at = ?
            WHERE category_id IS NULL
              AND id = (
                SELECT product_variants.canonical_product_id
                FROM receipt_items
                JOIN product_variants ON product_variants.id = receipt_items.product_variant_id
                WHERE receipt_items.id = ?
              )
          `).run(initialCategoryId, initialCategoryId, timestamp, itemId);
        }
      }
      for (const correction of input.corrections ?? []) {
        const itemId = itemIds[correction.itemIndex];
        if (!itemId) throw new RangeError('Receipt correction item index is invalid');
        this.#database.prepare('INSERT INTO receipt_corrections(id, receipt_item_id, field, original_json, corrected_json, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(createId('correction'), itemId, correction.field, JSON.stringify(correction.original), JSON.stringify(correction.corrected), timestamp);
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
    const directory = dirname(target);
    const targetName = basename(target);
    mkdirSync(directory, { recursive: true });
    const sourceBytes = statSync(this.path).size;
    pruneBackupDirectory(directory, this.#manualBackupRetention, {
      ignoredNames: new Set([targetName]),
      reserveCount: 1,
      reserveBytes: sourceBytes,
    });
    const bytes = createPortableBackup(this.path, target);
    if (bytes > this.#manualBackupRetention.maxBytes) {
      rmSync(target, { force: true });
      throw new Error('Manual backup exceeds the configured retention byte budget');
    }
    pruneBackupDirectory(directory, this.#manualBackupRetention, { protectedNames: new Set([targetName]) });
    return { path: target, bytes };
  }

  close(): void {
    this.#database.close();
  }
}

export function validateBackup(path: string): Readonly<{ valid: boolean; version: number }> {
  const database = new DatabaseSync(resolve(path), { readOnly: true });
  try {
    return { valid: integrityIsValid(database), version: schemaVersion(database) };
  } finally {
    database.close();
  }
}
