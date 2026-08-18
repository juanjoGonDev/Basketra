import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDeterministicReceiptOcr } from '../../src/receipts/extraction.ts';

test('deterministic OCR parsing preserves field confidence and source region without AI', () => {
  const items = parseDeterministicReceiptOcr({
    text: '2 x 0,89\nYOGUR NATURAL 1,78\nTOTAL 1,78',
    confidence: 0.9,
    lines: [
      {
        index: 1,
        text: '2 x 0,89',
        confidence: 0.98,
        region: { x: 0.1, y: 0.2, width: 0.25, height: 0.04 },
      },
      {
        index: 2,
        text: 'YOGUR NATURAL 1,78',
        confidence: 0.86,
        region: { x: 0.08, y: 0.25, width: 0.8, height: 0.05 },
      },
      {
        index: 3,
        text: 'TOTAL 1,78',
        confidence: 0.99,
        region: { x: 0.6, y: 0.9, width: 0.3, height: 0.04 },
      },
    ],
  });

  assert.equal(items.length, 1);
  assert.deepEqual(items[0], {
    description: 'YOGUR NATURAL',
    quantity: 2,
    unitPriceMinor: 89,
    lineTotalMinor: 178,
    confidence: 0.92,
    sourceLines: [1, 2],
    fieldConfidence: {
      description: 0.86,
      quantity: 0.98,
      unitPriceMinor: 0.98,
      lineTotalMinor: 0.86,
    },
    sourceRegion: {
      x: 0.08,
      y: 0.2,
      width: 0.8,
      height: 0.1,
    },
  });
});

test('deterministic OCR parsing falls back to overall OCR confidence when layout is unavailable', () => {
  const items = parseDeterministicReceiptOcr({
    text: 'PAN 1,50',
    confidence: 0.64,
  });
  assert.equal(items[0]?.confidence, 0.64);
  assert.deepEqual(items[0]?.fieldConfidence, {
    description: 0.64,
    quantity: 0.64,
    unitPriceMinor: 0.64,
    lineTotalMinor: 0.64,
  });
  assert.equal(items[0]?.sourceRegion, undefined);
});
