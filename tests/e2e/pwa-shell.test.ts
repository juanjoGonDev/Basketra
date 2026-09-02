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
  const receiptState = read('src/web/receipt-state.js');
  const receiptCapture = read('src/web/receipt-capture.js');
  const receiptLifecycle = read('src/web/receipt-lifecycle.js');
  const receiptProcessing = read('src/web/receipt-processing.js');
  const receiptReview = read('src/web/receipt-review.js');
  const receiptReviewCss = read('src/web/receipt-review.css');
  const ui = read('src/web/ui.js');
  const css = read('src/web/styles.css');
  const modernCss = read('src/web/modern.css');

  assert.match(html, /viewport-fit=cover/);
  assert.doesNotMatch(html, /user-scalable=no|maximum-scale=1/i);
  assert.match(html, /href="\/modern\.css"/);
  assert.match(html, /data-nav="lists"/);
  assert.match(html, /data-nav="inventory"/);
  assert.match(html, /src="\/inventory\.js"/);
  assert.match(html, /src="\/inventory-swipe\.js"/);
  assert.match(html, /src="\/ticket-history\.js"/);
  assert.doesNotMatch(html, /run-demo-comparison|data-view="prices"|>Planes</i);
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

  assert.equal(manifest.name, 'Basketra');
  assert.equal(manifest.short_name, 'Basketra');
  assert.equal(manifest.display, 'standalone');
  assert.ok(manifest.icons.length > 0);

  for (const asset of [
    '/api.js',
    '/routes.js',
    '/catalog.js',
    '/catalog.css',
    '/inventory.js',
    '/inventory.css',
    '/inventory-swipe.js',
    '/ticket-history.js',
    '/ticket-history.css',
    '/ticket-history-values.js',
    '/state.js',
    '/lists.js',
    '/receipts.js',
    '/receipt-state.js',
    '/receipt-capture.js',
    '/receipt-lifecycle.js',
    '/receipt-processing.js',
    '/receipt-review.js',
    '/receipt-review.css',
    '/ui.js',
    '/styles.css',
    '/modern.css',
  ]) {
    assert.ok(serviceWorker.includes(`'${asset}'`));
  }
  assert.match(serviceWorker, /url\.pathname\.startsWith\('\/api\/'\)/);
  assert.doesNotMatch(serviceWorker, /cache\.put[\s\S]*\/api\//);

  assert.match(app, /initLists/);
  assert.match(app, /initReceipts/);
  assert.match(app, /hydrateIcons\(\)/);
  assert.doesNotMatch(app, /runDemoComparison|optimizationPlan|renderPlanTabs/);
  assert.doesNotMatch(app, /basketra\.authToken|authorization/i);
  assert.doesNotMatch(api, /localStorage|Bearer|authorization/i);

  assert.match(state, /basketra\.activeListId/);
  assert.match(state, /basketra\.itemDraft/);
  assert.match(state, /basketra\.captures/);
  assert.match(state, /basketra\.receiptExtractionJobId/);
  assert.match(lists, /suggestionController\?\.abort/);
  assert.match(lists, /items\/order/);
  assert.match(lists, /completed/);

  assert.match(receipts, /startAutomaticCaptureProcessing/);
  assert.match(receipts, /Opciones de análisis/);
  assert.doesNotMatch(receipts, /extract-receipt/);
  assert.match(receiptState, /PAGE_CONCURRENCY = 2/);
  assert.match(receiptCapture, /\/api\/v1\/files\//);
  assert.match(receiptCapture, /OCR ha empezado automáticamente/);
  assert.match(receiptLifecycle, /\/api\/v1\/receipts\/extraction-jobs/);
  assert.match(receiptLifecycle, /new EventSource\(realtimeEndpoint\(\)\)/);
  assert.match(receiptLifecycle, /embeddedText/);
  assert.match(receiptProcessing, /Volver a analizar con IA/);
  assert.match(receiptProcessing, /captureRequest\(capture, page\.rawText\)/);
  assert.match(receiptReview, /receipt-review-reference-image/);
  assert.match(receiptReview, /El borrador se conserva/);
  assert.match(receiptReviewCss, /receipt-review-panel__body/);
  assert.match(receiptReviewCss, /receipt-review-evidence/);
  assert.match(ui, /export function shoppingListItem/);
  assert.match(ui, /export function receiptReview/);
  assert.match(ui, /data-capture-preview-image/);

  assert.match(css, /--touch:\s*3rem/);
  assert.match(css, /min-height:\s*var\(--touch\)/);
  assert.match(css, /safe-area-inset-bottom/);
  assert.match(css, /prefers-reduced-motion/);
  assert.match(css, /\.confirm-dialog/);
  assert.match(css, /\.preview-dialog/);
  assert.match(modernCss, /\.hero::after\s*{[\s\S]*display:\s*none/);
  assert.match(modernCss, /box-shadow:\s*none/);
  assert.match(modernCss, /\.capture-card__progress/);
  assert.match(modernCss, /prefers-reduced-motion/);
});
