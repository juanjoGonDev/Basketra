import type { MigrationDefinition } from './database.ts';
import { CATEGORY_MIGRATIONS } from './category-schema.ts';
import { COLLABORATION_MIGRATIONS as CORE_MIGRATIONS } from './collaboration-schema-core.ts';
import { INVENTORY_MIGRATIONS } from './inventory-schema.ts';

export const COLLABORATION_MIGRATIONS: readonly MigrationDefinition[] = [
  ...CORE_MIGRATIONS,
  ...CATEGORY_MIGRATIONS,
  ...INVENTORY_MIGRATIONS,
];
