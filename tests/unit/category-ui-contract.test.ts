import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

function source(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL(`../../${relativePath}`, import.meta.url)), 'utf8');
}

test('category inventory is loaded as part of the application shell', () => {
  const html = source('src/web/index.html');
  assert.match(html, /<script type="module" src="\/catalog\.js"><\/script>/u);
});

test('category UI separates list, detail and editor while preserving hierarchy and protected fallback', () => {
  const javascript = source('src/web/catalog.js');
  const css = source('src/web/catalog.css');

  assert.match(javascript, /data-view = 'categories'|view\.dataset\.view = 'categories'/u);
  assert.match(javascript, /category-list-screen/u);
  assert.match(javascript, /category-detail/u);
  assert.match(javascript, /category-editor/u);
  assert.match(javascript, /category-parent/u);
  assert.match(javascript, /type="color"/u);
  assert.match(javascript, /Añadir subcategoría/u);
  assert.match(javascript, /UNKNOWN_CATEGORY_NAME/u);
  assert.match(javascript, /category-search/u);
  assert.match(javascript, /category-prev/u);
  assert.match(javascript, /category-next/u);
  assert.doesNotMatch(javascript, /\b(?:alert|confirm|prompt)\s*\(/u);
  assert.match(css, /\.category-row/u);
  assert.match(css, /\.inventory-detail-screen/u);
});

test('category rendering preserves strict CSP without inline styles', () => {
  const javascript = source('src/web/catalog.js');
  const css = source('src/web/catalog.css');

  assert.doesNotMatch(javascript, /\.style(?:\.|\[)/u);
  assert.doesNotMatch(javascript, /\sstyle="/u);
  assert.match(javascript, /category-indent-step/u);
  assert.match(javascript, /setAttribute\('fill'/u);
  assert.match(css, /\.category-indent-step/u);
});

test('category UI delegates clean list, detail and new-category states to route-aware handlers', () => {
  const javascript = source('src/web/catalog.js');
  assert.match(javascript, /openRequestedCategory/u);
  assert.match(javascript, /requested === 'categories:new'/u);
  assert.match(javascript, /requested\.startsWith\('categories:'\)/u);
  assert.match(javascript, /writeCategoryRoute/u);
});
