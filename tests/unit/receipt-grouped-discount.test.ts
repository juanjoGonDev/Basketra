import test from 'node:test';
import assert from 'node:assert/strict';
import { assembleReceiptExtraction, type ReceiptPageEvidence } from '../../src/receipts/result.ts';

const coconut = (sourceLine: number) => ({
  description: 'BEBIDA COCO 0% A',
  quantity: 1,
  unitPriceMinor: 175,
  lineTotalMinor: 175,
  taxCategory: 'B' as const,
  confidence: 0.99,
  sourceLines: [sourceLine],
});

test('receipt finalization groups identical rows and assigns a uniquely reconcilable partial percentage discount', () => {
  const items = [
    coconut(1),
    coconut(2),
    {
      description: 'PAN',
      quantity: 1,
      unitPriceMinor: 100,
      lineTotalMinor: 100,
      taxCategory: 'B' as const,
      confidence: 0.99,
      sourceLines: [3],
    },
  ];
  const page: ReceiptPageEvidence = {
    position: 0,
    storageKey: 'receipt.png',
    mimeType: 'image/png',
    text: 'BEBIDA COCO 0% A 1,75\nBEBIDA COCO 0% A 1,75\nPAN 1,00\n50% dto BEBIDA COCO 0% A 0,88-',
    confidence: 1,
    source: 'embedded-text',
    deterministic: {
      items,
      metadata: { declaredTotalMinor: 362, articleCount: 3 },
    },
    ai: {
      attempts: 1,
      interpretation: {
        retailerName: 'ALCAMPO ALMERIA',
        declaredTotalMinor: 362,
        articleCount: 3,
        currency: 'EUR',
        correctedText: 'BEBIDA COCO 0% A 1,75\nBEBIDA COCO 0% A 1,75\nPAN 1,00\n50% dto BEBIDA COCO 0% A 0,88-',
        items,
        unassignedDiscounts: [{
          discount: { type: 'percentage', basisPoints: 5_000 },
          sourceLines: [4],
          description: 'BEBIDA COCO 0% A',
          reason: 'The 50% discount cannot be assigned uniquely because two identical product rows exist.',
        }],
        warnings: ['The BEBIDA COCO 0% A discount cannot be assigned because the product appears twice.'],
      },
    },
  };

  const result = assembleReceiptExtraction([page]);
  assert.equal(result.final.items.length, 2);
  const aggregated = result.final.items.find((item) => item.description === 'BEBIDA COCO 0% A');
  assert.ok(aggregated);
  assert.equal(aggregated.quantity, 2);
  assert.equal(aggregated.unitPriceMinor, 175);
  assert.equal(aggregated.lineTotalMinor, 262);
  assert.deepEqual(aggregated.discount, { type: 'percentage', basisPoints: 5_000, quantity: 1 });
  assert.deepEqual(aggregated.sourceLines, [1, 2, 4]);
  assert.equal(result.final.unassignedDiscounts, undefined);
  assert.deepEqual(result.final.warnings, []);
  assert.deepEqual(result.final.review.total, { expectedMinor: 362, differenceMinor: 0, valid: true });
});
