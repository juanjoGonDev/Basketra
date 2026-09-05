import assert from 'node:assert/strict';
import test from 'node:test';

import { mapError } from '../../src/api/errors.ts';

const RECEIPT_STORE_ERROR_CASES = [
  ['RECEIPT_STORE_REQUIRED', 'A Store is required to confirm the receipt'],
  ['RECEIPT_STORE_NOT_FOUND', 'Selected receipt Store was not found'],
  ['RECEIPT_STORE_RETAILER_REQUIRED', 'A retailer is required when confirming a Store by name'],
  ['RECEIPT_STORE_RETAILER_MISMATCH', 'Selected receipt Store belongs to another retailer'],
  ['RECEIPT_STORE_NAME_MISMATCH', 'Selected receipt Store name does not match the saved Store'],
] as const;

test('receipt Store failures map to the stable validation API contract', () => {
  for (const [internalMessage, expectedMessage] of RECEIPT_STORE_ERROR_CASES) {
    const mapped = mapError(new Error(internalMessage));

    assert.equal(mapped.status, 400, internalMessage);
    assert.equal(mapped.code, 'VALIDATION_ERROR', internalMessage);
    assert.equal(mapped.message, expectedMessage, internalMessage);
  }
});
