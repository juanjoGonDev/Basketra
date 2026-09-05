import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const invoice = readFileSync(new URL('../../src/web/receipt-editor-invoice.js', import.meta.url), 'utf8');
const app = readFileSync(new URL('../../src/web/app.js', import.meta.url), 'utf8');
const history = readFileSync(new URL('../../src/web/ticket-history.js', import.meta.url), 'utf8');

test('receipt line dialogs share one invoice shell owner', () => {
  assert.match(invoice, /export function createReceiptInvoiceLineDialog/u);
  assert.match(app, /createReceiptInvoiceLineDialog/u);
  assert.match(history, /createReceiptInvoiceLineDialog/u);
  assert.doesNotMatch(app, /dialog\.innerHTML\s*=\s*`[\s\S]*Línea del ticket/u);
  assert.doesNotMatch(history, /lineDialog\.innerHTML\s*=\s*`[\s\S]*Línea del ticket/u);
  assert.doesNotMatch(history, /class="receipt-item receipt-item--editing"[^>]*data-receipt-line-editor/u);
  assert.match(history, /class="ticket-history-line-editor receipt-item--editing"[^>]*data-receipt-line-editor/u);
  assert.match(invoice, /summaryTitleId/u);
  assert.doesNotMatch(invoice, /heading\.id = 'receipt-line-editor-summary-title'/u);
});
