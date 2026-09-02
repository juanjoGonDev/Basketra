import { DatabaseSync } from 'node:sqlite';
import {
  AI_NEW_CATEGORY_ID_PATTERN,
  UNKNOWN_CATEGORY_COLOR,
  UNKNOWN_CATEGORY_ID,
  UNKNOWN_CATEGORY_NAME,
  assertCategoryParentReference,
  normalizeCategoryColor,
  normalizeCategoryName,
  normalizeOptionalCategoryColor,
  type AiCategoryProposal,
  type CategoryDescriptor,
} from '../domain/categories.ts';
import { createId } from './ids.ts';

export type ProductCategoryRecord = CategoryDescriptor & Readonly<{
  createdAt: string;
  updatedAt: string;
}>;

export type MaterializedCategoryProposal = Readonly<{
  references: ReadonlyMap<string, string>;
  created: readonly ProductCategoryRecord[];
}>;

type CategoryRow = Readonly<{
  id: string;
  name: string;
  parentId: string | null;
  color: string | null;
  description: string | null;
  createdAt: string;
  updatedAt: string;
}>;

function mapCategory(row: CategoryRow): ProductCategoryRecord {
  return {
    id: row.id,
    name: row.name,
    ...(row.parentId ? { parentId: row.parentId } : {}),
    ...(row.color ? { color: row.color } : {}),
    ...(row.description ? { description: row.description } : {}),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function categoryById(database: DatabaseSync, id: string): CategoryRow | undefined {
  return database.prepare(`
    SELECT id, name, parent_id AS parentId, color, description,
      created_at AS createdAt, updated_at AS updatedAt
    FROM product_categories
    WHERE id = ?
  `).get(id) as CategoryRow | undefined;
}

function categoryByName(database: DatabaseSync, name: string): CategoryRow | undefined {
  return database.prepare(`
    SELECT id, name, parent_id AS parentId, color, description,
      created_at AS createdAt, updated_at AS updatedAt
    FROM product_categories
    WHERE name = ? COLLATE NOCASE
  `).get(name) as CategoryRow | undefined;
}

function assertParentExists(database: DatabaseSync, parentId?: string): void {
  if (!parentId) return;
  if (!categoryById(database, parentId)) throw new Error('PRODUCT_CATEGORY_PARENT_NOT_FOUND');
}

function assertNoCycle(database: DatabaseSync, id: string, parentId?: string): void {
  if (!parentId) return;
  const cycle = database.prepare(`
    WITH RECURSIVE ancestors(id, parent_id) AS (
      SELECT id, parent_id FROM product_categories WHERE id = ?
      UNION ALL
      SELECT parent.id, parent.parent_id
      FROM product_categories AS parent
      JOIN ancestors ON parent.id = ancestors.parent_id
      WHERE ancestors.parent_id IS NOT NULL
    )
    SELECT 1 AS cycle FROM ancestors WHERE id = ? LIMIT 1
  `).get(parentId, id) as { cycle: number } | undefined;
  if (cycle) throw new Error('PRODUCT_CATEGORY_CYCLE');
}

function normalizeDescription(value?: string | null): string | undefined {
  if (value === undefined || value === null) return undefined;
  const normalized = value.trim();
  if (normalized.length > 500) throw new RangeError('Category description is too long');
  return normalized || undefined;
}

export class CategoryRepository {
  readonly #databasePath: string;
  readonly #clock: () => Date;

  constructor(databasePath: string, clock: () => Date = () => new Date()) {
    this.#databasePath = databasePath;
    this.#clock = clock;
  }

  list(): ProductCategoryRecord[] {
    return this.withDatabase((database) => (database.prepare(`
      SELECT id, name, parent_id AS parentId, color, description,
        created_at AS createdAt, updated_at AS updatedAt
      FROM product_categories
      ORDER BY name COLLATE NOCASE, id
    `).all() as CategoryRow[]).map(mapCategory), true);
  }

  get(id: string): ProductCategoryRecord | undefined {
    return this.withDatabase((database) => {
      const row = categoryById(database, id);
      return row ? mapCategory(row) : undefined;
    }, true);
  }

  getOrCreate(input: Readonly<{
    name: string;
    parentId?: string | null;
    color?: string | null;
    description?: string | null;
  }>): ProductCategoryRecord {
    const name = normalizeCategoryName(input.name);
    const parentId = assertCategoryParentReference('', input.parentId);
    const color = normalizeOptionalCategoryColor(input.color);
    const description = normalizeDescription(input.description);
    return this.withDatabase((database) => {
      const existing = categoryByName(database, name);
      if (existing) return mapCategory(existing);
      assertParentExists(database, parentId);
      const id = createId('category');
      const timestamp = this.#clock().toISOString();
      database.prepare(`
        INSERT INTO product_categories(id, name, parent_id, color, description, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(id, name, parentId ?? null, color ?? null, description ?? null, timestamp, timestamp);
      return mapCategory(categoryById(database, id)!);
    });
  }

  update(id: string, input: Readonly<{
    name: string;
    parentId?: string | null;
    color?: string | null;
    description?: string | null;
  }>): ProductCategoryRecord | undefined {
    const name = normalizeCategoryName(input.name);
    const parentId = assertCategoryParentReference(id, input.parentId);
    const color = normalizeOptionalCategoryColor(input.color);
    const description = normalizeDescription(input.description);
    return this.withDatabase((database) => {
      const current = categoryById(database, id);
      if (!current) return undefined;
      if (id === UNKNOWN_CATEGORY_ID) {
        if (name.toLocaleLowerCase('es-ES') !== UNKNOWN_CATEGORY_NAME || parentId) {
          throw new Error('UNKNOWN_CATEGORY_PROTECTED');
        }
      }
      assertParentExists(database, parentId);
      assertNoCycle(database, id, parentId);
      const timestamp = this.#clock().toISOString();
      database.exec('BEGIN IMMEDIATE');
      try {
        database.prepare(`
          UPDATE product_categories
          SET name = ?, parent_id = ?, color = ?, description = ?, updated_at = ?
          WHERE id = ?
        `).run(name, parentId ?? null, color ?? null, description ?? null, timestamp, id);
        database.prepare(`
          UPDATE canonical_products SET category = ?, updated_at = ? WHERE category_id = ?
        `).run(name, timestamp, id);
        database.exec('COMMIT');
      } catch (error) {
        database.exec('ROLLBACK');
        throw error;
      }
      return mapCategory(categoryById(database, id)!);
    });
  }

  materialize(proposals: readonly AiCategoryProposal[]): MaterializedCategoryProposal {
    if (proposals.length === 0) return { references: new Map(), created: [] };
    return this.withDatabase((database) => {
      const normalized = proposals.map((proposal) => ({
        id: proposal.id,
        name: normalizeCategoryName(proposal.name),
        ...(proposal.parentId ? { parentId: proposal.parentId.trim() } : {}),
        color: normalizeCategoryColor(proposal.color),
        ...(normalizeDescription(proposal.description) ? { description: normalizeDescription(proposal.description)! } : {}),
      }));
      const ids = new Set<string>();
      for (const proposal of normalized) {
        if (!AI_NEW_CATEGORY_ID_PATTERN.test(proposal.id)) throw new Error('AI_CATEGORY_REFERENCE_INVALID');
        if (ids.has(proposal.id)) throw new Error('AI_CATEGORY_REFERENCE_DUPLICATED');
        ids.add(proposal.id);
      }
      const references = new Map<string, string>();
      const created: ProductCategoryRecord[] = [];
      const pending = [...normalized];
      database.exec('BEGIN IMMEDIATE');
      try {
        while (pending.length > 0) {
          let progressed = false;
          for (let index = pending.length - 1; index >= 0; index -= 1) {
            const proposal = pending[index]!;
            let parentId: string | undefined;
            if (proposal.parentId) {
              if (AI_NEW_CATEGORY_ID_PATTERN.test(proposal.parentId)) {
                parentId = references.get(proposal.parentId);
                if (!parentId) continue;
              } else {
                parentId = proposal.parentId;
                if (!categoryById(database, parentId)) throw new Error('AI_CATEGORY_PARENT_NOT_FOUND');
              }
            }
            const existing = categoryByName(database, proposal.name);
            if (existing) {
              references.set(proposal.id, existing.id);
              pending.splice(index, 1);
              progressed = true;
              continue;
            }
            const id = createId('category');
            const timestamp = this.#clock().toISOString();
            database.prepare(`
              INSERT INTO product_categories(id, name, parent_id, color, description, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?)
            `).run(id, proposal.name, parentId ?? null, proposal.color, proposal.description ?? null, timestamp, timestamp);
            const stored = mapCategory(categoryById(database, id)!);
            references.set(proposal.id, id);
            created.push(stored);
            pending.splice(index, 1);
            progressed = true;
          }
          if (!progressed) throw new Error('AI_CATEGORY_CYCLE');
        }
        database.exec('COMMIT');
      } catch (error) {
        database.exec('ROLLBACK');
        throw error;
      }
      return { references, created };
    });
  }

  ensureUnknown(): ProductCategoryRecord {
    return this.withDatabase((database) => {
      const existing = categoryById(database, UNKNOWN_CATEGORY_ID);
      if (existing) return mapCategory(existing);
      const timestamp = this.#clock().toISOString();
      database.prepare(`
        INSERT OR IGNORE INTO product_categories(id, name, parent_id, color, description, created_at, updated_at)
        VALUES (?, ?, NULL, ?, NULL, ?, ?)
      `).run(UNKNOWN_CATEGORY_ID, UNKNOWN_CATEGORY_NAME, UNKNOWN_CATEGORY_COLOR, timestamp, timestamp);
      const stored = categoryById(database, UNKNOWN_CATEGORY_ID);
      if (!stored) throw new Error('UNKNOWN_CATEGORY_NOT_AVAILABLE');
      return mapCategory(stored);
    });
  }

  private withDatabase<T>(callback: (database: DatabaseSync) => T, readOnly = false): T {
    const database = new DatabaseSync(this.#databasePath, readOnly ? { readOnly: true } : {});
    try {
      database.exec('PRAGMA foreign_keys = ON;');
      return callback(database);
    } finally {
      database.close();
    }
  }
}
