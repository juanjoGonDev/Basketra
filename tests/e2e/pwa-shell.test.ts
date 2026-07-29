import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('mobile PWA shell exposes critical workflows and safe offline caching', () => {
  const html = readFileSync('src/web/index.html', 'utf8');
  const manifest = JSON.parse(readFileSync('src/web/manifest.webmanifest', 'utf8')) as { name: string; short_name: string; display: string; icons: unknown[] };
  const serviceWorker = readFileSync('src/web/sw.js', 'utf8');
  const app = readFileSync('src/web/app.js', 'utf8');
  const ui = readFileSync('src/web/ui.js', 'utf8');
  const css = readFileSync('src/web/styles.css', 'utf8');

  assert.match(html, /viewport-fit=cover/);
  assert.match(html, /data-nav="lists"/);
  assert.match(html, /data-icon="home"/);
  assert.match(html, /id="receipt-files"/);
  assert.match(html, /id="run-demo-comparison"/);
  assert.match(html, /id="ai-mode"/);
  assert.equal(manifest.name, 'Basketra');
  assert.equal(manifest.short_name, 'Basketra');
  assert.equal(manifest.display, 'standalone');
  assert.ok(manifest.icons.length > 0);
  assert.match(serviceWorker, /url\.pathname\.startsWith\('\/api\/'\)/);
  assert.match(serviceWorker, /'\/ui\.js'/);
  assert.match(serviceWorker, /url\.pathname\.startsWith\('\/files\/'\)/);
  assert.match(app, /localStorage\.setItem\('basketra\.itemDraft'/);
  assert.match(app, /suggestionController\?\.abort/);
  assert.match(app, /aiController\?\.abort/);
  assert.match(app, /hydrateIcons\(\)/);
  assert.match(ui, /export function shoppingListItem/);
  assert.match(ui, /export function receiptReview/);
  assert.match(css, /--touch:\s*3rem/);
  assert.match(css, /min-height:\s*var\(--touch\)/);
  assert.match(css, /safe-area-inset-bottom/);
  assert.match(css, /prefers-reduced-motion/);
});
