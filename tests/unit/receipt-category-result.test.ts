import assert from 'node:assert/strict';
import test from 'node:test';

import type { CategoryDescriptor } from '../../src/domain/categories.ts';
import {
  assembleReceiptExtraction,
  type ReceiptPageEvidence,
} from '../../src/receipts/result.ts';

const existingCategory: CategoryDescriptor = {
  id: 'category_drinks',
  name: 'Bebidas',
  color: '#118844',
};

const unusedCategory: CategoryDescriptor = {
  id: 'category_unused',
  name: 'Sin usar',
  color: '#445566',
};

const page: ReceiptPageEvidence = {
  position: 0,
  storageKey: 'receipt.png',
  mimeType: 'image/png',
  text: 'LECHE 1,20\nPATATAS 1,50',
  confidence: 0.95,
  source: 'embedded-text',
  deterministic: {
    items: [],
    metadata: {},
  },
  ai: {
    attempts: 1,
    interpretation: {
      currency: 'EUR',
      correctedText: 'LECHE 1,20\nPATATAS 1,50',
      items: [
        {
          description: 'LECHE',
          quantity: 1,
          unitPriceMinor: 120,
          lineTotalMinor: 120,
          confidence: 0.95,
          categoryId: existingCategory.id,
          sourceLines: [1],
        },
        {
          description: 'PATATAS',
          quantity: 1,
          unitPriceMinor: 150,
          lineTotalMinor: 150,
          confidence: 0.95,
          categoryId: 'category_snacks',
          sourceLines: [2],
        },
      ],
      newCategories: [{
        id: 'category_snacks',
        name: 'Aperitivos',
        color: '#AA5500',
      }],
      warnings: [],
    },
  },
};

test('receipt extraction exposes only category descriptors referenced by final lines', () => {
  const result = assembleReceiptExtraction([page], [existingCategory, unusedCategory]);

  assert.deepEqual(result.final.categories, [
    existingCategory,
    {
      id: 'category_snacks',
      name: 'Aperitivos',
      color: '#AA5500',
    },
  ]);
});

test('receipt extraction does not invent a category snapshot for unclassified lines', () => {
  const unclassified: ReceiptPageEvidence = {
    ...page,
    ai: undefined,
    deterministic: {
      items: [{
        description: 'LECHE',
        quantity: 1,
        unitPriceMinor: 120,
        lineTotalMinor: 120,
        confidence: 0.9,
        sourceLines: [1],
      }],
      metadata: {},
    },
  };

  const result = assembleReceiptExtraction([unclassified], [existingCategory]);

  assert.deepEqual(result.final.categories, []);
});
