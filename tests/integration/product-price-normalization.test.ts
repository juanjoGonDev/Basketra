import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { BasketraServer } from '../../src/api/server.ts';
import { BasketraDatabase } from '../../src/infrastructure/database.ts';
import { FileStore } from '../../src/infrastructure/files.ts';

test('product price normalization returns server-owned display units', async () => {
  const root = mkdtempSync(join(tmpdir(), 'basketra-price-normalization-'));
  const database = new BasketraDatabase(join(root, 'basketra.db'));
  const server = new BasketraServer({
    database,
    fileStore: new FileStore(join(root, 'files'), join(root, 'tmp'), 1024 * 1024),
    port: 0,
  });
  try {
    await server.listen();
    const address = server.address();
    assert.ok(address);
    const baseUrl = `http://127.0.0.1:${address.port}`;

    const response = await fetch(`${baseUrl}/api/v1/products/price-normalization`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        priceMinor: 200,
        packageNumerator: 500,
        packageDenominator: 1,
        packageUnit: 'g',
      }),
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      normalizedPriceMinor: 400,
      normalizedPriceUnit: 'kg',
    });
  } finally {
    await server.close();
    rmSync(root, { recursive: true, force: true });
  }
});
