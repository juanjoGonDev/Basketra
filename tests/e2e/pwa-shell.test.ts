import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

function read(path: string): string {
  return readFileSync(path, 'utf8');
}

test('mobile PWA shell exposes complete private workflows and safe offline caching', () => {
  const html = read('src/web/index.html');
  const manifest = JSON.parse(read('src/web/manifest.webmanifest')) as {
    id: string;
    name: string;
    short_name: string;
    version: string;
    display: string;
    icons: Array<{ src: string; sizes: string; type: string; purpose: string }>;
  };
  const serviceWorker = read('src/web/sw.js');
  const icon = read('src/web/icon.svg');
  const buildScript = read('scripts/build.mjs');
  const dockerfile = read('Dockerfile');
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
  const density = read('src/web/shopping-list-density.js');
  const densityCss = read('src/web/shopping-list-density.css');

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

  assert.equal(manifest.id, '/');
  assert.equal(manifest.name, 'Basketra');
  assert.equal(manifest.short_name, 'Basketra');
  assert.equal(manifest.version, '__BASKETRA_VERSION__');
  assert.equal(manifest.display, 'standalone');
  assert.deepEqual(manifest.icons, [{
    src: '/icon.svg',
    sizes: 'any',
    type: 'image/svg+xml',
    purpose: 'any maskable',
  }]);
  assert.match(icon, /viewBox="0 0 512 512"/);
  assert.match(icon, /<title[^>]*>Basketra<\/title>/);
  assert.doesNotMatch(icon, /<image\b|data:image|href="https?:/i);
  assert.match(buildScript, /BASKETRA_VERSION/);
  assert.match(buildScript, /replaceAll\(VERSION_PLACEHOLDER, version\)/);
  assert.match(buildScript, /dist\/web\/sw\.js/);
  assert.match(buildScript, /dist\/web\/manifest\.webmanifest/);
  assert.match(dockerfile, /FROM node:22\.23\.1-alpine3\.24 AS build[\s\S]*ARG BASKETRA_VERSION=0\.0\.0-dev/);
  assert.match(dockerfile, /RUN node scripts\/build\.mjs/);

  for (const asset of [
    '/api.js',
    '/routes.js',
    '/catalog.js',
    '/catalog.css',
    '/inventory.js',
    '/inventory.css',
    '/inventory-swipe.js',
    '/inventory-swipe.css',
    '/entity-selection.js',
    '/ticket-history.js',
    '/ticket-history.css',
    '/ticket-history-values.js',
    '/state.js',
    '/lists.js',
    '/shopping-list-density.js',
    '/shopping-list-density.css',
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
  assert.match(serviceWorker, /basketra-shell-__BASKETRA_VERSION__/);
  assert.match(serviceWorker, /NAVIGATION_TIMEOUT_MS\s*=\s*1_500/);
  assert.match(serviceWorker, /SHELL_PATHS\.has\(url\.pathname\)/);
  assert.match(serviceWorker, /url\.pathname\.startsWith\('\/api\/'\)/);

  assert.match(density, /aria-expanded/);
  assert.match(density, /aria-controls/);
  assert.match(density, /MutationObserver/);
  assert.match(density, /shopping-item-disclosure__panel/);
  assert.match(densityCss, /shopping-item-disclosure__panel\[hidden\]/);
  assert.match(densityCss, /grid-template-areas:[\s\S]*"complete identity total disclosure"/);

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
