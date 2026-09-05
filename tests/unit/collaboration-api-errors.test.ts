import assert from 'node:assert/strict';
import test from 'node:test';

import { mapError } from '../../src/api/errors.ts';

const ERROR_CASES = [
  ['SHOPPING_LIST_NOT_FOUND', 404, 'SHOPPING_LIST_NOT_FOUND'],
  ['SHOPPING_LIST_ITEM_NOT_FOUND', 404, 'SHOPPING_LIST_ITEM_NOT_FOUND'],
  ['PRODUCT_CATEGORY_NOT_FOUND', 404, 'PRODUCT_CATEGORY_NOT_FOUND'],
  ['CANONICAL_PRODUCT_NOT_FOUND', 404, 'CANONICAL_PRODUCT_NOT_FOUND'],
  ['PRODUCT_VARIANT_NOT_FOUND', 404, 'PRODUCT_VARIANT_NOT_FOUND'],
  ['STORE_NOT_FOUND', 404, 'STORE_NOT_FOUND'],
  ['REALTIME_CLIENT_LIMIT_REACHED', 503, 'REALTIME_CLIENT_LIMIT_REACHED'],
  ['OVERPASS_UNAVAILABLE', 502, 'NEARBY_STORE_PROVIDER_UNAVAILABLE'],
  ['OVERPASS_RESPONSE_TOO_LARGE', 502, 'NEARBY_STORE_PROVIDER_RESPONSE_TOO_LARGE'],
  ['OVERPASS_INVALID_RESPONSE', 502, 'NEARBY_STORE_PROVIDER_INVALID_RESPONSE'],
] as const;

test('collaboration infrastructure failures map to stable public API contracts', () => {
  for (const [internalMessage, expectedStatus, expectedCode] of ERROR_CASES) {
    const mapped = mapError(new Error(internalMessage));

    assert.equal(mapped.status, expectedStatus, internalMessage);
    assert.equal(mapped.code, expectedCode, internalMessage);
  }
});
