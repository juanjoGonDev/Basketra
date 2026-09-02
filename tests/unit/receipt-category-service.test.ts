import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  UNKNOWN_CATEGORY_COLOR,
  UNKNOWN_CATEGORY_ID,
  UNKNOWN_CATEGORY_NAME,
} from '../../src/domain/categories.ts';
import { BasketraDatabase } from '../../src/infrastructure/database.ts';
import { FileStore } from '../../src/infrastructure/files.ts';
import { ReceiptExtractionService } from '../../src/receipts/service.ts';

test('receipt category service validates storage and supplies the stable fallback without a snapshot', () => {
  const root = mkdtempSync(join(tmpdir(), 'basketra-receipt-category-service-'));
  const database = new BasketraDatabase(join(root, 'basketra.db'));
  const fileStore = new FileStore(join(root, 'files'), join(root, 'tmp'), 4096);
  const service = new ReceiptExtractionService(
    fileStore,
    () => {
      throw new Error('AI provider must not be used by category inventory lookup');
    },
    0,
  );
  const request = { captures: [], verifyWithAi: true } as const;

  try {
    assert.throws(
      () => service.configureCategoryDatabase('   '),
      {
        name: 'RangeError',
        message: 'Category database path is required',
      },
    );
    assert.deepEqual(service.categoryInventoryFor(request), []);

    service.configureCategoryDatabase(database.path);
    const fallback = service.categoryInventoryFor(request);
    assert.equal(fallback.length, 1);
    assert.equal(fallback[0]?.id, UNKNOWN_CATEGORY_ID);
    assert.equal(fallback[0]?.name, UNKNOWN_CATEGORY_NAME);
    assert.equal(fallback[0]?.color, UNKNOWN_CATEGORY_COLOR);

    const explicitInventory = [{
      id: 'category_food',
      name: 'Alimentación',
      color: '#118844',
    }] as const;
    assert.equal(
      service.categoryInventoryFor({ ...request, categoryInventory: explicitInventory }),
      explicitInventory,
    );
  } finally {
    service.dispose();
    database.close();
    rmSync(root, { recursive: true, force: true });
  }
});
