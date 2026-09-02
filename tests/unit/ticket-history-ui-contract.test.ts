import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

function source(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL(`../../${relativePath}`, import.meta.url)), 'utf8');
}

test('ticket history is a first-class Tickets workflow backed by bounded server queries', () => {
  const script = source('src/web/ticket-history.js');
  assert.match(script, /data-view = 'ticket-history'|dataset\.view = 'ticket-history'/u);
  assert.match(script, /\/api\/v1\/inventory\/tickets\?/u);
  assert.match(script, /limit: String\(PAGE_SIZE\)/u);
  assert.match(script, /AbortController/u);
  assert.match(script, /dateFrom/u);
  assert.match(script, /dateTo/u);
  assert.match(script, /storeId/u);
  assert.match(script, /categoryId/u);
  assert.match(script, /paymentStatus/u);
});

test('historical line totals use the canonical calculation endpoint and destructive actions use preflight', () => {
  const script = source('src/web/ticket-history.js');
  assert.match(script, /\/api\/v1\/receipts\/calculate-line/u);
  assert.match(script, /\/delete-impact/u);
  assert.match(script, /data-swipe-kind="ticket-history"/u);
  assert.match(script, /data-ticket-action="edit"/u);
  assert.match(script, /data-ticket-action="delete"/u);
  assert.match(script, /Total backend/u);
  assert.match(script, /Se recalcula al guardar/u);
});

test('ticket history assets are part of the canonical static allowlist and loaded by the shell', () => {
  const assets = source('src/api/static-assets.ts');
  const html = source('src/web/index.html');
  assert.match(assets, /'ticket-history\.js'/u);
  assert.match(assets, /'ticket-history\.css'/u);
  assert.match(html, /<script type="module" src="\/ticket-history\.js"><\/script>/u);
  assert.doesNotMatch(html, /run-demo-comparison/u);
});
