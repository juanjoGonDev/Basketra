import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const index = readFileSync('src/web/index.html', 'utf8');
const staticAssets = readFileSync('src/api/static-assets.ts', 'utf8');
const serviceWorker = readFileSync('src/web/sw.js', 'utf8');
const themeScript = readFileSync('src/web/theme.js', 'utf8');
const themeStyles = readFileSync('src/web/theme.css', 'utf8');

test('theme preference loads before application paint and is part of the static shell', () => {
  const themeScriptIndex = index.indexOf('<script src="/theme.js"></script>');
  const structuralStylesIndex = index.indexOf('<link rel="stylesheet" href="/styles.css">');
  const modernStylesIndex = index.indexOf('<link rel="stylesheet" href="/modern.css">');
  const themeStylesIndex = index.indexOf('<link rel="stylesheet" href="/theme.css">');
  const operationsStylesIndex = index.indexOf('<link rel="stylesheet" href="/operations.css">');

  assert.ok(themeScriptIndex > 0);
  assert.ok(themeScriptIndex < structuralStylesIndex, 'saved theme must be applied before CSS paint');
  assert.ok(modernStylesIndex < themeStylesIndex);
  assert.ok(themeStylesIndex < operationsStylesIndex);
  assert.match(staticAssets, /'theme\.js'/u);
  assert.match(staticAssets, /'theme\.css'/u);
  assert.match(serviceWorker, /'\/theme\.js'/u);
  assert.match(serviceWorker, /'\/theme\.css'/u);
});

test('theme preference owns one device-local key and exposes system, light and dark choices', () => {
  assert.match(themeScript, /const STORAGE_KEY = 'basketra\.theme'/u);
  assert.match(themeScript, /new Set\(\['system', 'light', 'dark'\]\)/u);
  assert.match(themeScript, /document\.documentElement\.dataset\.theme = preference/u);
  assert.match(themeScript, /localStorage\.setItem\(STORAGE_KEY, value\)/u);
  assert.match(themeScript, /data-tab-panel="general"/u);
  assert.match(themeScript, /name="basketra-theme" value="system"/u);
  assert.match(themeScript, /name="basketra-theme" value="light"/u);
  assert.match(themeScript, /name="basketra-theme" value="dark"/u);
});

test('explicit themes pin browser color scheme and reuse the canonical semantic palette values', () => {
  assert.match(themeStyles, /html\[data-theme="light"\][\s\S]*color-scheme: only light/u);
  assert.match(themeStyles, /html\[data-theme="dark"\][\s\S]*color-scheme: only dark/u);
  assert.match(themeStyles, /--color-bg: #f3fcf5/u);
  assert.match(themeStyles, /--color-on-surface: #151d19/u);
  assert.match(themeStyles, /--color-bg: #0f1713/u);
  assert.match(themeStyles, /--color-on-surface: #e7f0e9/u);
  assert.match(themeStyles, /min-height: var\(--touch\)/u);
});
