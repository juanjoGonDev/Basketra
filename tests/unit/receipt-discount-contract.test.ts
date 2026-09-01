import test from 'node:test';
import assert from 'node:assert/strict';
import { handleReceiptLineCalculationRequest } from '../../src/api/receipt-calculation.ts';
import { RECEIPT_SCHEMA, buildReceiptVerificationInstructions } from '../../src/receipts/extraction.ts';
import { parseReceiptConfirmation } from '../../src/receipts/import.ts';
import { assembleReceiptExtraction } from '../../src/receipts/result.ts';

function calculationRequest(body: unknown): Request {
  return new Request('http://basketra.test/api/v1/receipts/calculate-line', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function confirmationItem(overrides: Record<string, unknown> = {}) {
  return {
    description: 'BEBIDA COCO',
    quantity: 1,
    unitPriceMinor: 175,
    lineTotalMinor: 87,
    confidence: 1,
    userConfirmed: true,
    ...overrides,
  };
}

function confirmation(items: readonly unknown[]) {
  return {
    importKey: 'receipt-discount-contract',
    declaredTotalMinor: 87,
    originalText: 'BEBIDA COCO 1,75\n50% dto BEBIDA COCO 0% A 0,88-\nTOTAL 0,87',
    items,
  };
}

test('receipt calculation API accepts percentage and amount tagged discounts', async () => {
  const percentage = await handleReceiptLineCalculationRequest(calculationRequest({
    quantity: 1,
    unitPriceMinor: 175,
    discount: { type: 'percentage', basisPoints: 5_000 },
  }));
  assert.ok(percentage);
  assert.deepEqual(await percentage.json(), { lineTotalMinor: 87, discountMinor: 88 });

  const amount = await handleReceiptLineCalculationRequest(calculationRequest({
    quantity: 1,
    unitPriceMinor: 175,
    discount: { type: 'amount', amountMinor: 88 },
  }));
  assert.ok(amount);
  assert.deepEqual(await amount.json(), { lineTotalMinor: 87, discountMinor: 88 });
});

test('receipt calculation API preserves legacy amount compatibility and rejects mixed contracts', async () => {
  const legacy = await handleReceiptLineCalculationRequest(calculationRequest({
    quantity: 1,
    unitPriceMinor: 175,
    discountMinor: 88,
  }));
  assert.ok(legacy);
  assert.deepEqual(await legacy.json(), { lineTotalMinor: 87, discountMinor: 88 });

  await assert.rejects(() => handleReceiptLineCalculationRequest(calculationRequest({
    quantity: 1,
    unitPriceMinor: 175,
    discountMinor: 88,
    discount: { type: 'percentage', basisPoints: 5_000 },
  })), /representation is mixed/i);
  await assert.rejects(() => handleReceiptLineCalculationRequest(calculationRequest({
    quantity: 1,
    unitPriceMinor: 175,
    discount: { type: 'percentage', basisPoints: 10_001 },
  })), /cannot exceed 100%/i);
});

test('receipt confirmation persists the locally resolved amount while preserving typed corrections', () => {
  const parsed = parseReceiptConfirmation({
    ...confirmation([confirmationItem({ discount: { type: 'percentage', basisPoints: 5_000 } })]),
    corrections: [{
      itemIndex: 0,
      field: 'discount',
      original: null,
      corrected: { type: 'percentage', basisPoints: 5_000 },
    }],
  });
  assert.equal(parsed.input.items[0]?.discountMinor, 88);
  assert.deepEqual(parsed.input.corrections?.[0], {
    itemIndex: 0,
    field: 'discount',
    original: null,
    corrected: { type: 'percentage', basisPoints: 5_000 },
  });

  const legacy = parseReceiptConfirmation(confirmation([
    confirmationItem({ discountMinor: 88 }),
  ]));
  assert.equal(legacy.input.items[0]?.discountMinor, 88);
});

test('receipt confirmation rejects mixed typed and legacy discount representations', () => {
  assert.throws(() => parseReceiptConfirmation(confirmation([
    confirmationItem({
      discountMinor: 88,
      discount: { type: 'percentage', basisPoints: 5_000 },
    }),
  ])), /representation is mixed/i);
});

test('AI receipt schema accepts tagged discounts and validates them locally', () => {
  const value = RECEIPT_SCHEMA.parse({
    currency: 'EUR',
    correctedText: 'BEBIDA COCO 1,75\n50% dto BEBIDA COCO 0% A 0,88-',
    items: [{
      description: 'BEBIDA COCO',
      quantity: 1,
      unitPriceMinor: 175,
      lineTotalMinor: 87,
      discount: { type: 'percentage', basisPoints: 5_000 },
      confidence: 0.95,
      sourceLines: [1, 2],
    }],
    warnings: [],
  });
  assert.deepEqual(value.items[0]?.discount, { type: 'percentage', basisPoints: 5_000 });

  const amount = RECEIPT_SCHEMA.parse({
    currency: 'EUR',
    correctedText: 'PROMO 0,88-',
    items: [{
      description: 'BEBIDA COCO',
      quantity: 1,
      unitPriceMinor: 175,
      lineTotalMinor: 87,
      discount: { type: 'amount', amountMinor: 88 },
      confidence: 0.95,
      sourceLines: [1],
    }],
    warnings: [],
  });
  assert.deepEqual(amount.items[0]?.discount, { type: 'amount', amountMinor: 88 });
});

test('AI receipt schema rejects malformed or mixed discount objects', () => {
  const base = {
    currency: 'EUR',
    correctedText: 'BEBIDA COCO',
    warnings: [],
  };
  const item = {
    description: 'BEBIDA COCO',
    quantity: 1,
    unitPriceMinor: 175,
    lineTotalMinor: 87,
    confidence: 0.95,
    sourceLines: [1],
  };
  assert.throws(() => RECEIPT_SCHEMA.parse({
    ...base,
    items: [{ ...item, discount: { type: 'percentage', basisPoints: 5_000, amountMinor: 88 } }],
  }), /representation is mixed/i);
  assert.throws(() => RECEIPT_SCHEMA.parse({
    ...base,
    items: [{ ...item, discount: { type: 'percentage', basisPoints: 10_001 } }],
  }), /cannot exceed 100%/i);
  assert.throws(() => RECEIPT_SCHEMA.parse({
    ...base,
    items: [{ ...item, discount: { type: 'amount', amountMinor: 176 } }],
  }), /discount cannot exceed/i);
});

test('ambiguous Alcampo duplicate discounts remain unassigned for manual review', () => {
  const interpretation = RECEIPT_SCHEMA.parse({
    currency: 'EUR',
    correctedText: [
      'BEBIDA COCO 1,75',
      'BEBIDA COCO 1,75',
      '50% dto BEBIDA COCO 0% A 0,88-',
    ].join('\n'),
    items: [
      { description: 'BEBIDA COCO', quantity: 1, unitPriceMinor: 175, lineTotalMinor: 175, confidence: 0.8, sourceLines: [1] },
      { description: 'BEBIDA COCO', quantity: 1, unitPriceMinor: 175, lineTotalMinor: 175, confidence: 0.8, sourceLines: [2] },
    ],
    unassignedDiscounts: [{
      discount: { type: 'percentage', basisPoints: 5_000 },
      sourceLines: [3],
      description: 'BEBIDA COCO',
      reason: 'Two identical item rows make ownership ambiguous.',
    }],
    warnings: ['A 50% / EUR 0.88 discount needs manual assignment.'],
  });
  assert.equal(interpretation.items.some((entry) => entry.discount !== undefined), false);
  assert.deepEqual(interpretation.unassignedDiscounts?.[0]?.discount, { type: 'percentage', basisPoints: 5_000 });

  const assembled = assembleReceiptExtraction([{
    position: 0,
    storageKey: 'receipt-page-1',
    mimeType: 'image/png',
    text: interpretation.correctedText,
    confidence: 0.9,
    source: 'local-tesseract',
    deterministic: { items: [], metadata: {} },
    ai: { interpretation, attempts: 1 },
  }]);
  assert.deepEqual(assembled.final.unassignedDiscounts, interpretation.unassignedDiscounts);
  assert.equal(assembled.final.items.some((entry) => entry.discount !== undefined), false);
  assert.match(assembled.final.warnings[0] ?? '', /manual assignment/i);
});

test('AI instructions define tagged discounts and ambiguous ownership behavior', () => {
  const instructions = buildReceiptVerificationInstructions();
  assert.match(instructions, /basis points/i);
  assert.match(instructions, /50%.*5000/iu);
  assert.match(instructions, /unassignedDiscounts/u);
  assert.match(instructions, /do not attach it to any item/iu);
});
