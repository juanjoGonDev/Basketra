import assert from 'node:assert/strict';
import test from 'node:test';

import { createPagedSelection } from '../../src/web/entity-selection.js';

test('paged selection persists explicit ids across page changes and reports hidden selections', () => {
  const selection = createPagedSelection({ limit: 5 });
  selection.set('a', true);
  selection.set('b', true);

  assert.deepEqual(selection.pageState(['a', 'c']), {
    selectedOnPage: 1,
    pageSize: 2,
    allSelected: false,
    someSelected: true,
    selectedOutsidePage: 1,
  });

  selection.setPage(['c', 'd'], true);
  assert.deepEqual(selection.values(), ['a', 'b', 'c', 'd']);
  assert.deepEqual(selection.pageState(['c', 'd']), {
    selectedOnPage: 2,
    pageSize: 2,
    allSelected: true,
    someSelected: false,
    selectedOutsidePage: 2,
  });

  selection.setPage(['c', 'd'], false);
  assert.deepEqual(selection.values(), ['a', 'b']);
});

test('paged selection exposes deterministic ids regardless of page selection order', () => {
  const selection = createPagedSelection({ limit: 5 });
  selection.setPage(['variant_page_2'], true);
  selection.setPage(['variant_page_1'], true);

  assert.deepEqual(selection.values(), ['variant_page_1', 'variant_page_2']);
});

test('paged selection fails closed when the explicit selection limit would be exceeded', () => {
  const selection = createPagedSelection({ limit: 2 });
  selection.set('a', true);
  selection.set('b', true);
  assert.throws(() => selection.set('c', true), /limited to 2/u);
  assert.deepEqual(selection.values(), ['a', 'b']);
});
