import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { BasketraDatabase } from '../../src/infrastructure/database.ts';

test('new variants reuse an existing canonical parent without duplicating it', () => {
  const root = mkdtempSync(join(tmpdir(), 'basketra-parent-variant-'));
  const databasePath = join(root, 'basketra.db');
  const database = new BasketraDatabase(databasePath);
  try {
    const whole = database.createProduct({
      canonicalName: 'Leche',
      variantName: 'Leche entera 1 L',
      brand: 'Marca A',
      packageMinor: 1,
      packageUnit: 'l',
    });
    const semi = database.createProduct({
      canonicalProductId: whole.canonicalProductId,
      variantName: 'Leche semidesnatada 1 L',
      brand: 'Marca B',
      packageMinor: 1,
      packageUnit: 'l',
    });
    assert.equal(semi.canonicalProductId, whole.canonicalProductId);
    assert.equal(semi.canonicalName, 'Leche');
    assert.deepEqual(database.searchCanonicalProducts('lech', 8).map((parent) => ({
      id: parent.id,
      name: parent.name,
      variantCount: parent.variantCount,
    })), [{ id: whole.canonicalProductId, name: 'Leche', variantCount: 2 }]);
    assert.throws(() => database.createProduct({
      canonicalProductId: whole.canonicalProductId,
      canonicalName: 'Duplicada',
      variantName: 'No válida',
    }), /variant fields only/);
    assert.throws(() => database.createProduct({
      canonicalProductId: 'product_missing',
      variantName: 'No existe',
    }), /CANONICAL_PRODUCT_NOT_FOUND/);
  } finally {
    database.close();
  }
  const raw = new DatabaseSync(databasePath, { readOnly: true });
  try {
    const parents = raw.prepare('SELECT COUNT(*) AS count FROM canonical_products').get() as { count: number };
    const variants = raw.prepare('SELECT COUNT(*) AS count FROM product_variants').get() as { count: number };
    assert.equal(Number(parents.count), 1);
    assert.equal(Number(variants.count), 2);
  } finally {
    raw.close();
    rmSync(root, { recursive: true, force: true });
  }
});
