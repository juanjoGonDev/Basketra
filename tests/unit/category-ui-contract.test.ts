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

test('category UI supports hierarchy, color editing and protected fallback without native alerts', () => {
  const javascript = source('src/web/catalog.js');
  const css = source('src/web/catalog.css');

  assert.match(javascript, /data-view="categories"/u);
  assert.match(javascript, /category-parent/u);
  assert.match(javascript, /type="color"/u);
  assert.match(javascript, /Añadir subcategoría/u);
  assert.match(javascript, /UNKNOWN_CATEGORY_NAME/u);
  assert.doesNotMatch(javascript, /\b(?:alert|confirm|prompt)\s*\(/u);
  assert.match(css, /\.category-layout/u);
  assert.match(css, /\.category-row/u);
});

test('direct category hash activation does not shadow the activation function', () => {
  const javascript = source('src/web/catalog.js');
  assert.doesNotMatch(javascript, /function initializeCatalogFeature\(\{ activate = false, activateCategories = false \}/u);
  assert.match(javascript, /activateCategoryView: requested === 'categories'/u);
});
