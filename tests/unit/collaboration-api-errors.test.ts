import assert from 'node:assert/strict';
import test from 'node:test';

import { buildUnexpectedErrorLog, mapError } from '../../src/api/errors.ts';

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


test('unexpected SQLite logs expose only bounded generic SQLite diagnostics', () => {
  const event = buildUnexpectedErrorLog(
    Object.assign(new Error('sensitive SQL or receipt data'), {
      code: 'ERR_SQLITE_ERROR',
      errcode: 5,
      errstr: 'database is locked',
    }),
    'incident-test',
    '2026-09-06T21:28:23.453Z',
  );

  assert.deepEqual(event, {
    timestamp: '2026-09-06T21:28:23.453Z',
    level: 'error',
    event: 'http.unexpected_error',
    incidentId: 'incident-test',
    errorName: 'Error',
    systemCode: 'ERR_SQLITE_ERROR',
    sqliteErrcode: 5,
    sqliteErrstr: 'database is locked',
  });
  assert.equal(JSON.stringify(event).includes('sensitive'), false);
});

test('unexpected error logs ignore invalid or non-SQLite diagnostic fields', () => {
  const nonSqlite = buildUnexpectedErrorLog(
    { code: 'EIO', errcode: 5, errstr: 'database is locked' },
    'incident-non-sqlite',
    '2026-09-06T21:28:23.453Z',
  );
  assert.equal('sqliteErrcode' in nonSqlite, false);
  assert.equal('sqliteErrstr' in nonSqlite, false);

  const invalidSqlite = buildUnexpectedErrorLog(
    {
      code: 'ERR_SQLITE_ERROR',
      errcode: Number.MAX_SAFE_INTEGER,
      errstr: 'x'.repeat(81),
    },
    'incident-invalid-sqlite',
    '2026-09-06T21:28:23.453Z',
  );
  assert.equal('sqliteErrcode' in invalidSqlite, false);
  assert.equal('sqliteErrstr' in invalidSqlite, false);
});
