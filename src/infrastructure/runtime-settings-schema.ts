import type { MigrationDefinition } from './database.ts';

export const RUNTIME_SETTINGS_MIGRATIONS: readonly MigrationDefinition[] = [
  {
    version: 16,
    kind: 'safe',
    sql: `
      ALTER TABLE runtime_settings
      ADD COLUMN theme TEXT NOT NULL DEFAULT 'system'
      CHECK(theme IN ('system', 'light', 'dark'));
    `,
  },
];
