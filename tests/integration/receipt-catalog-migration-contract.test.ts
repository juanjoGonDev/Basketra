import test from 'node:test';
import assert from 'node:assert/strict';
import { CURRENT_SCHEMA_VERSION } from '../../src/infrastructure/database.ts';
import { COLLABORATION_MIGRATIONS } from '../../src/infrastructure/collaboration-schema.ts';

test('receipt catalog projection is owned by the latest safe schema migration', () => {
  const migration = COLLABORATION_MIGRATIONS.at(-1);
  assert.equal(CURRENT_SCHEMA_VERSION, 7);
  assert.equal(migration?.version, 7);
  assert.equal(migration?.kind, 'safe');
  assert.match(migration?.sql ?? '', /CREATE TRIGGER receipt_items_project_catalog/u);
  assert.match(migration?.sql ?? '', /'receipt-item:' \|\| NEW\.id/u);
  assert.match(migration?.sql ?? '', /NEW\.unit_price_minor/u);
  assert.match(migration?.sql ?? '', /product_variant_id/u);
});
