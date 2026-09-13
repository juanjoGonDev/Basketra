import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeSearchText } from '../../src/web/search-normalize.js';

test('search picker ignores case and Spanish diacritics', () => {
  assert.equal(normalizeSearchText('VÍCAR'), 'vicar');
  assert.equal(normalizeSearchText('  Álcampo  '), '  alcampo  ');
  assert.equal(normalizeSearchText('vicar'), normalizeSearchText('VÍCAR'));
});
