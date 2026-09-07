import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const index = readFileSync('src/web/index.html', 'utf8');
const staticAssets = readFileSync('src/api/static-assets.ts', 'utf8');
const serviceWorker = readFileSync('src/web/sw.js', 'utf8');
const themeScript = readFileSync('src/web/theme.js', 'utf8');
const themeStyles = readFileSync('src/web/theme.css', 'utf8');
const modernStyles = readFileSync('src/web/modern.css', 'utf8');
const inventoryStyles = readFileSync('src/web/inventory.css', 'utf8');

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

test('theme preference owns one device-local key and materializes the effective system theme', () => {
  assert.match(themeScript, /const STORAGE_KEY = 'basketra\.theme'/u);
  assert.match(themeScript, /new Set\(\['system', 'light', 'dark'\]\)/u);
  assert.match(themeScript, /document\.documentElement\.dataset\.theme = effectiveTheme\(preference\)/u);
  assert.match(themeScript, /localStorage\.setItem\(STORAGE_KEY, value\)/u);
  assert.match(themeScript, /if \(preference === 'system'\) applyPreference\(preference\)/u);
  assert.match(themeScript, /data-tab-panel="general"/u);
  assert.match(themeScript, /name="basketra-theme" value="system"/u);
  assert.match(themeScript, /name="basketra-theme" value="light"/u);
  assert.match(themeScript, /name="basketra-theme" value="dark"/u);
});

test('modern stylesheet remains the canonical palette owner for explicit themes', () => {
  assert.match(modernStyles, /html\[data-theme="light"\][\s\S]*color-scheme: only light/u);
  assert.match(modernStyles, /html\[data-theme="dark"\][\s\S]*color-scheme: only dark/u);
  assert.match(modernStyles, /--color-bg: #f3fcf5/u);
  assert.match(modernStyles, /--color-on-surface: #151d19/u);
  assert.match(modernStyles, /--color-bg: #0f1713/u);
  assert.match(modernStyles, /--color-on-surface: #e7f0e9/u);
  assert.doesNotMatch(themeStyles, /--color-bg:/u);
  assert.match(themeStyles, /min-height: var\(--touch\)/u);
});

test('globally injected inventory shell follows the canonical application palette', () => {
  assert.match(
    inventoryStyles,
    /@media \(max-width: 52rem\) \{[\s\S]*?body \{\s*background: var\(--color-bg\);/u,
  );
  assert.match(
    inventoryStyles,
    /body \.app-header \{[\s\S]*?background: color-mix\(in srgb, var\(--color-surface\) 96%, var\(--color-primary\) 4%\);/u,
  );
  assert.match(
    inventoryStyles,
    /body \.bottom-nav \{[\s\S]*?background: var\(--color-surface\);/u,
  );
});
