import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';

const webRoot = 'src/web';
const read = (path: string) => readFileSync(path, 'utf8');

test('shared native web components own the dialog and form primitives', () => {
  const components = read(`${webRoot}/components.js`);
  const css = read(`${webRoot}/components.css`);
  for (const name of ['app-dialog', 'app-field', 'app-button', 'app-stack', 'app-inline', 'app-select']) {
    assert.match(components, new RegExp(name));
    assert.match(css, new RegExp(name));
  }
  assert.match(components, /createAppDialog/);
  assert.match(components, /showModal/);
});

test('features cannot construct native dialogs outside the shared component module', () => {
  const featureSources = readdirSync(webRoot)
    .filter(file => file.endsWith('.js') && file !== 'components.js')
    .map(file => [file, read(`${webRoot}/${file}`)] as const);
  for (const [file, source] of featureSources) {
    assert.doesNotMatch(source, /createElement\(['"]dialog['"]\)/u, file);
    assert.doesNotMatch(source, /<dialog\b/u, file);
  }
  assert.doesNotMatch(read(`${webRoot}/index.html`), /<dialog\b/u);
  const receiptCapture = read(`${webRoot}/receipt-capture.js`);
  assert.match(receiptCapture, /createAppDialog/);
  assert.doesNotMatch(receiptCapture, /receipt-source-editor__|document\.createElement\(['"]dialog['"]\)/u);
});

test('component runtime stays local and lightweight', () => {
  const components = read(`${webRoot}/components.js`);
  assert.doesNotMatch(components, /https?:\/\//u);
  assert.ok(statSync(`${webRoot}/components.js`).size < 8_000, 'component module must stay below 8 KB');
  assert.ok(statSync(`${webRoot}/components.css`).size < 4_000, 'component stylesheet must stay below 4 KB');
});

test('receipt presentation keeps amounts inset and invoice actions in one desktop row', () => {
  const review = read(`${webRoot}/receipt-review.css`);
  const invoice = read(`${webRoot}/receipt-editor-invoice.css`);
  assert.match(review, /\.receipt-detected-item\s*\{[\s\S]*?padding: var\(--space-2\) var\(--space-3\);/u);
  assert.match(invoice, /\.receipt-invoice-dialog \.receipt-invoice-dialog__actions\s*\{[\s\S]*?grid-template-columns: repeat\(4, minmax\(0, 1fr\)\);/u);
  assert.match(invoice, /\.receipt-editor-summary__stamp\s*\{\s*display: none;/u);
});

test('the component gallery and its local assets are included in the offline shell', () => {
  const html = read(`${webRoot}/index.html`);
  const worker = read(`${webRoot}/sw.js`);
  const assets = read('src/api/static-assets.ts');
  assert.match(html, /data-view="components"/);
  assert.match(html, /src="\/components\.js"/);
  assert.match(html, /href="\/components\.css"/);
  assert.match(worker, /'\/components\.js'/);
  assert.match(worker, /'\/components\.css'/);
  assert.match(assets, /'components\.js'/);
  assert.match(assets, /'components\.css'/);
});
