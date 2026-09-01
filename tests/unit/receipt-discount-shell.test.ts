import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('service worker versions and precaches the typed receipt discount stylesheet', () => {
  const source = readFileSync(new URL('../../src/web/sw.js', import.meta.url), 'utf8');
  assert.match(source, /basketra-shell-v22/u);
  assert.match(source, /'\/receipt-discount\.css'/u);
});
