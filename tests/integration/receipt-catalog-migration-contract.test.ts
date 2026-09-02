import test from 'node:test';
import assert from 'node:assert/strict';
import { CURRENT_SCHEMA_VERSION } from '../../src/infrastructure/database.ts';
import { COLLABORATION_MIGRATIONS } from '../../src/infrastructure/collaboration-schema.ts';

const RECEIPT_CATALOG_MIGRATION_VERSION = 7;

test('receipt catalog projection remains owned by its safe schema migration', () => {
  const migration = COLLABORATION_MIGRATIONS.find((entry) => entry.version === RECEIPT_CATALOG_MIGRATION_VERSION);
  assert.ok(CURRENT_SCHEMA_VERSION > RECEIPT_CATALOG_MIGRATION_VERSION);
  assert.equal(migration?.version, RECEIPT_CATALOG_MIGRATION_VERSION);
  assert.equal(migration?.kind, 'safe');
  assert.match(migration?.sql ?? '', /CREATE TRIGGER receipt_items_project_catalog/u);
  assert.match(migration?.sql ?? '', /'receipt-item:' \|\| NEW\.id/u);
  assert.match(migration?.sql ?? '', /NEW\.unit_price_minor/u);
  assert.match(migration?.sql ?? '', /product_variant_id/u);
});
