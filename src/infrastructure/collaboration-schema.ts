import type { MigrationDefinition } from './database.ts';
import { COLLABORATION_MIGRATIONS as CORE_MIGRATIONS } from './collaboration-schema-core.ts';
import { INVENTORY_MIGRATIONS } from './inventory-schema.ts';

export const COLLABORATION_MIGRATIONS: readonly MigrationDefinition[] = [
  ...CORE_MIGRATIONS,
  ...INVENTORY_MIGRATIONS,
];
