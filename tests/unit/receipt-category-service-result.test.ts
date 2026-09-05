import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';

import type { AiProvider } from '../../src/ai/provider.ts';
import { CategoryRepository } from '../../src/infrastructure/category-repository.ts';
import { BasketraDatabase } from '../../src/infrastructure/database.ts';
import { FileStore } from '../../src/infrastructure/files.ts';
import { ReceiptExtractionService } from '../../src/receipts/service.ts';

test('direct receipt extraction carries the request category snapshot into the final result', async () => {
  const root = mkdtempSync(join(tmpdir(), 'basketra-receipt-category-result-'));
  const database = new BasketraDatabase(join(root, 'basketra.db'));
  const categories = new CategoryRepository(database.path);
  const category = categories.getOrCreate({
    name: 'Bebidas',
    color: '#118844',
  });
  const fileStore = new FileStore(join(root, 'files'), join(root, 'tmp'), 4096);
  const stored = fileStore.storeBase64({
    base64: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00]).toString('base64'),
    mimeType: 'image/png',
    originalName: 'ticket.png',
  });
  const provider: AiProvider = {
    async getCapabilities() {
      return {
        structuredOutput: true,
        jsonObject: true,
        image: true,
        pdf: false,
        internetSearch: false,
      };
    },
    async testConnection() {
      return { ok: true };
    },
    async executeStructured() {
      return {
        currency: 'EUR',
        correctedText: 'LECHE 1,20',
        items: [{
          description: 'LECHE',
          quantity: 1,
          unitPriceMinor: 120,
          lineTotalMinor: 120,
          confidence: 0.95,
          categoryId: category.id,
          sourceLines: [1],
        }],
        newCategories: [],
        warnings: [],
      };
    },
    dispose() {},
  };
  const service = new ReceiptExtractionService(fileStore, () => provider, 0);
  service.configureCategoryDatabase(database.path);

  try {
    const request = service.parseRequest({
      captures: [{
        storageKey: stored.storageKey,
        originalName: 'ticket.png',
        embeddedText: 'LECHE 1,20',
      }],
      verifyWithAi: true,
    });
    const result = await service.extract(request);

    assert.deepEqual(
      result.final.categories.map(({ id, name, color }) => ({ id, name, color })),
      [{ id: category.id, name: 'Bebidas', color: '#118844' }],
    );
  } finally {
    service.dispose();
    database.close();
    rmSync(root, { recursive: true, force: true });
  }
});
