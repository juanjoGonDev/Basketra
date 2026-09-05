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

test('primary navigation replaces Plans with Inventory in the same slot and removes the legacy Plans implementation', () => {
  const html = source('src/web/index.html');
  const app = source('src/web/app.js');
  assert.match(html, /<button data-nav="inventory"><span data-icon="prices"><\/span><span>Inventario<\/span><\/button>/u);
  assert.match(html, /<script type="module" src="\/inventory\.js"><\/script>/u);
  assert.doesNotMatch(html, /data-nav="prices"/u);
  assert.doesNotMatch(html, />Planes<\/span>/u);
  assert.doesNotMatch(html, /run-demo-comparison/u);
  assert.doesNotMatch(html, /id="plans"/u);
  assert.doesNotMatch(app, /runDemoComparison/u);
  assert.doesNotMatch(app, /renderPlanTabs/u);
  assert.doesNotMatch(app, /planPresentation/u);
});

test('inventory hub is served by the existing shell and defines the four approved destinations', () => {
  const html = source('src/web/index.html');
  assert.match(html, /data-view="inventory"/u);
  assert.match(html, /data-nav="catalog">Productos/u);
  assert.match(html, /data-nav="categories">Categorías/u);
  assert.match(html, /data-nav="stores">Tiendas/u);
  assert.match(html, /data-nav="inventory-statistics">Estadísticas/u);
  assert.match(html, /data-view="stores"/u);
  assert.match(html, /data-view="inventory-statistics"/u);
  assert.doesNotMatch(html, /Planes de compra/u);
});
