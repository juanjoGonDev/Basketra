import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

function read(path: string): string {
  return readFileSync(path, 'utf8');
}

test('mobile PWA shell exposes complete private workflows and safe offline caching', () => {
  const html = read('src/web/index.html');
  const manifest = JSON.parse(read('src/web/manifest.webmanifest')) as { name: string; short_name: string; display: string; icons: unknown[] };
  const serviceWorker = read('src/web/sw.js');
  const app = read('src/web/app.js');
  const api = read('src/web/api.js');
  const state = read('src/web/state.js');
  const lists = read('src/web/lists.js');
  const receipts = read('src/web/receipts.js');
  const ui = read('src/web/ui.js');
  const css = read('src/web/styles.css');

  assert.match(html, /viewport-fit=cover/);
  assert.match(html, /data-nav="lists"/);
  assert.match(html, /id="new-list-form"/);
  assert.match(html, /id="rename-list-form"/);
  assert.match(html, /id="delete-list-dialog"/);
  assert.match(html, /id="pending-items"/);
  assert.match(html, /id="completed-items"/);
  assert.match(html, /id="realtime-state"/);
  assert.match(html, /id="open-ai-assistant"/);
  assert.match(html, /id="verify-receipt-ai"/);
  assert.match(html, /id="receipt-camera"[^>]*accept="image\/jpeg,image\/png"[^>]*capture="environment"/);
  assert.match(html, /id="receipt-files"[^>]*application\/pdf/);
  assert.match(html, /id="capture-preview-dialog"/);
  assert.match(html, /Basketra no requiere token de aplicación/);
  assert.match(html, /id="run-demo-comparison"/);

  assert.equal(manifest.name, 'Basketra');
  assert.equal(manifest.short_name, 'Basketra');
  assert.equal(manifest.display, 'standalone');
  assert.ok(manifest.icons.length > 0);

  for (const asset of ['/api.js', '/state.js', '/lists.js', '/receipts.js', '/ui.js']) {
    assert.ok(serviceWorker.includes(`'${asset}'`));
  }
  assert.match(serviceWorker, /url\.pathname\.startsWith\('\/api\/'\)/);
  assert.doesNotMatch(serviceWorker, /cache\.put[\s\S]*\/api\//);

  assert.match(app, /initLists/);
  assert.match(app, /initReceipts/);
  assert.match(app, /hydrateIcons\(\)/);
  assert.doesNotMatch(app, /basketra\.authToken|authorization/i);
  assert.doesNotMatch(api, /localStorage|Bearer|authorization/i);

  assert.match(state, /basketra\.activeListId/);
  assert.match(state, /basketra\.itemDraft/);
  assert.match(state, /basketra\.captures/);
  assert.match(lists, /suggestionController\?\.abort/);
  assert.match(lists, /items\/order/);
  assert.match(lists, /completed/);
  assert.match(receipts, /capture="environment"|receipt-camera/);
  assert.match(receipts, /\/api\/v1\/files\//);
  assert.match(receipts, /El borrador se conserva/);
  assert.match(ui, /export function shoppingListItem/);
  assert.match(ui, /export function receiptReview/);
  assert.match(ui, /data-capture-preview-image/);

  assert.match(css, /--touch:\s*3rem/);
  assert.match(css, /min-height:\s*var\(--touch\)/);
  assert.match(css, /safe-area-inset-bottom/);
  assert.match(css, /prefers-reduced-motion/);
  assert.match(css, /\.confirm-dialog/);
  assert.match(css, /\.preview-dialog/);
});
