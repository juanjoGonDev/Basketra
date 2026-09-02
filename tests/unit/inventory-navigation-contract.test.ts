import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

function source(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL(`../../${relativePath}`, import.meta.url)), 'utf8');
}

test('approved inventory visual baselines are committed and referenced by the manifest', () => {
  const manifest = JSON.parse(source('.agents/specs/assets/2026-09-02-professional-inventory/visual-reference.json')) as {
    assets: Array<{ image: string }>;
  };
  assert.equal(manifest.assets.length, 6);
  for (const asset of manifest.assets) {
    const path = fileURLToPath(new URL(`../../${asset.image}`, import.meta.url));
    assert.equal(existsSync(path), true, `${asset.image} must be committed`);
  }
});

test('primary navigation replaces Plans with Inventory in the same slot', () => {
  const html = source('src/web/index.html');
  assert.match(html, /<button data-nav="inventory"><span data-icon="prices"><\/span><span>Inventario<\/span><\/button>/u);
  assert.doesNotMatch(html, /data-nav="prices"/u);
  assert.doesNotMatch(html, />Planes<\/span>/u);
  assert.match(html, /<script type="module" src="\/inventory\.js"><\/script>/u);
});

test('inventory module removes the legacy plan view and defines the four approved sections', () => {
  const javascript = source('src/web/inventory.js');
  const css = source('src/web/inventory.css');
  assert.match(javascript, /data-view="inventory"/u);
  assert.match(javascript, /Productos/u);
  assert.match(javascript, /Categorías/u);
  assert.match(javascript, /Tiendas/u);
  assert.match(javascript, /Estadísticas/u);
  assert.doesNotMatch(javascript, /Planes de compra/u);
  assert.match(css, /\.inventory-hub/u);
});
