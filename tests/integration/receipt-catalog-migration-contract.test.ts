import test from 'node:test';
import assert from 'node:assert/strict';
import { CURRENT_SCHEMA_VERSION } from '../../src/infrastructure/database.ts';
import { COLLABORATION_MIGRATIONS } from '../../src/infrastructure/collaboration-schema.ts';

const RECEIPT_CATALOG_MIGRATION_VERSION = 7;

test('receipt catalog projection remains owned by its safe schema migration', () => {
  const migration = COLLABORATION_MIGRATIONS.find(
    (candidate) => candidate.version === RECEIPT_CATALOG_MIGRATION_VERSION,
  );
  assert.ok(CURRENT_SCHEMA_VERSION >= RECEIPT_CATALOG_MIGRATION_VERSION);
  assert.equal(migration?.version, RECEIPT_CATALOG_MIGRATION_VERSION);
  assert.equal(migration?.kind, 'safe');
  assert.match(migration?.sql ?? '', /CREATE TRIGGER receipt_items_project_catalog/u);
  assert.match(migration?.sql ?? '', /'receipt-item:' \|\| NEW\.id/u);
  assert.match(migration?.sql ?? '', /NEW\.unit_price_minor/u);
  assert.match(migration?.sql ?? '', /product_variant_id/u);
});


test('receipt Store ownership is enforced by forward-safe migration 14 while migration 12 remains a compatibility fallback', () => {
  const compatibility = COLLABORATION_MIGRATIONS.find(candidate => candidate.version === 12);
  const ownership = COLLABORATION_MIGRATIONS.find(candidate => candidate.version === 14);
  assert.ok(compatibility);
  assert.ok(ownership);
  assert.equal(compatibility.kind, 'safe');
  assert.equal(ownership.kind, 'safe');
  assert.match(compatibility.sql, /CREATE TRIGGER receipt_price_observation_assign_store/u);
  assert.match(ownership.sql, /CREATE TRIGGER receipt_price_observation_write_store/u);
  assert.match(ownership.sql, /BEFORE INSERT ON price_observations/u);
  assert.match(ownership.sql, /external_evidence\.source_type = 'receipt'/u);
  assert.match(ownership.sql, /external_evidence\.source_reference = 'receipt-item:' \|\| receipt_items\.id/u);
  assert.match(ownership.sql, /receipts\.store_id/u);
  assert.doesNotMatch(ownership.sql, /DROP TRIGGER/u);
});
