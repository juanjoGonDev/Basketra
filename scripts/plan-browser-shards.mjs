import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const DEFAULT_ESTIMATED_SECONDS = 8;

export const TIMING_HINTS_SECONDS = new Map([
  ['tests/browser/changed-code-residuals.spec.mjs › catalog residual branches cover rich history, nested categories and destructive outcomes', 34],
  ['tests/browser/changed-code-boundaries.spec.mjs › catalog product boundaries cover filters, validation, relations, allowed deletes and errors', 28],
  ['tests/browser/changed-code-residuals.spec.mjs › catalog and inventory defensive residuals cover partial payloads and alternate route state', 24],
  ['tests/browser/ai-provider-diagnostics.spec.mjs › provider diagnostic renders every stable recovery message and 200-level negative capability', 21],
  ['tests/browser/changed-code-residuals.spec.mjs › inventory final changed-code branches cover missing controls, stale loads and Store actions', 23],
  ['tests/browser/changed-code-boundaries.spec.mjs › catalog category boundaries cover filters, creation, allowed deletes and errors', 23],
  ['tests/browser/basketra.spec.mjs › shopping lists support progressive swipe reveal, completion, full-delete and undo', 21],
  ['tests/browser/changed-code-boundaries.spec.mjs › inventory Store CRUD, filters, validation and statistics exercise alternate states', 21],
  ['tests/browser/changed-code-residuals.spec.mjs › catalog final changed-code branches cover DOM guards, stale loads and bounded validation', 21],
  ['tests/browser/inventory-row-actions.spec.mjs › inventory entity rows share accessible swipe actions and preserve canonical delete preflights', 18],
  ['tests/browser/shared-controls-visual.spec.mjs › shared controls align helper fields and retain rounded navigation at 390px', 18],
  ['tests/browser/inventory-layout-regressions.spec.mjs › inventory overview tabs stay visible and reachable at every supported viewport', 15],
  ['tests/browser/shared-controls-visual.spec.mjs › shared controls align helper fields and retain rounded navigation at 1920px', 17],
  ['tests/browser/ai-provider-diagnostics.spec.mjs › settings render remote, invalid, host, loopback and missing provider states', 12],
  ['tests/browser/changed-code-residuals.spec.mjs › inventory residual branches cover overview routing, Store guards and non-empty statistics', 15],
  ['tests/browser/shopping-ticket.spec.mjs › shopping ticket estimates by effective Store and converges between devices', 14],
  ['tests/browser/shared-controls-visual.spec.mjs › shared controls align helper fields and retain rounded navigation at 320px', 14],
  ['tests/browser/shared-controls-visual.spec.mjs › shared controls align helper fields and retain rounded navigation at 1440px', 16],
  ['tests/browser/shared-controls-visual.spec.mjs › shared controls align helper fields and retain rounded navigation at 768px', 15],
  ['tests/browser/category-management.spec.mjs › hierarchical categories use separate list, detail and editor flows on mobile and desktop', 14],
  ['tests/browser/mobile-settings-receipts.spec.mjs › settings remain readable and unobscured across light and dark responsive layouts', 12],
  ['tests/browser/basketra.spec.mjs › automatic local OCR creates editable euro rows with source context and imports without AI', 12],
]);

export function normalizeTestListEntry(entry) {
  return entry
    .trim()
    .replace(/^\[[^\]]+\]\s*[›>]\s*/u, '')
    .replace(/:\d+:\d+(?=\s*[›>]\s*)/u, '')
    .replace(/\s*>\s*/gu, ' › ')
    .replace(/\s*›\s*/gu, ' › ');
}

export function parsePlaywrightList(content) {
  const totalMatch = content.match(/^Total:\s+(\d+)\s+tests?/mu);
  if (!totalMatch) throw new Error('Playwright --list output is missing its total test count.');

  const entries = content
    .split('\n')
    .map(line => line.trim())
    .filter(line => /^(?:\[[^\]]+\]\s*[›>]\s*)?tests\/browser\/.+\.spec\.mjs:\d+:\d+\s*[›>]\s*.+$/u.test(line));

  const expected = Number(totalMatch[1]);
  if (entries.length !== expected) {
    throw new Error('Parsed ' + entries.length + ' Browser tests but Playwright reported ' + expected + '.');
  }

  const tests = entries.map((entry, index) => {
    const key = normalizeTestListEntry(entry);
    return {
      entry,
      key,
      index,
      estimatedSeconds: TIMING_HINTS_SECONDS.get(key) ?? DEFAULT_ESTIMATED_SECONDS,
    };
  });

  if (new Set(tests.map(test => test.key)).size !== tests.length) {
    throw new Error('Browser test-list entries must remain uniquely addressable.');
  }
  return tests;
}

export function planBrowserShards(tests, requestedGroups) {
  if (!Number.isInteger(requestedGroups) || requestedGroups < 1 || requestedGroups > 256) {
    throw new Error('Browser shard count must be an integer between 1 and 256.');
  }
  if (tests.length === 0) throw new Error('Browser shard planner requires at least one test.');

  const total = Math.min(requestedGroups, tests.length);
  const groups = Array.from({ length: total }, (_, index) => ({
    id: index + 1,
    estimatedSeconds: 0,
    tests: [],
  }));

  const ordered = [...tests].sort((left, right) =>
    right.estimatedSeconds - left.estimatedSeconds ||
    left.key.localeCompare(right.key)
  );

  for (const candidate of ordered) {
    groups.sort((left, right) =>
      left.estimatedSeconds - right.estimatedSeconds ||
      left.tests.length - right.tests.length ||
      left.id - right.id
    );
    const group = groups[0];
    group.tests.push(candidate);
    group.estimatedSeconds += candidate.estimatedSeconds;
  }

  for (const group of groups) {
    group.tests.sort((left, right) => left.index - right.index);
  }
  groups.sort((left, right) => left.id - right.id);
  return groups;
}

export function writeBrowserShardFiles(groups, outputDirectory) {
  rmSync(outputDirectory, { recursive: true, force: true });
  mkdirSync(outputDirectory, { recursive: true });
  for (const group of groups) {
    const path = resolve(outputDirectory, 'shard-' + group.id + '.txt');
    writeFileSync(path, group.tests.map(test => test.entry).join('\n') + '\n', 'utf8');
  }
}

function main(args) {
  const [listPath, requestedGroupsRaw, outputDirectory] = args;
  if (!listPath || !requestedGroupsRaw || !outputDirectory) {
    throw new Error('Usage: node scripts/plan-browser-shards.mjs <playwright-list> <group-count> <output-directory>');
  }

  const requestedGroups = Number(requestedGroupsRaw);
  const tests = parsePlaywrightList(readFileSync(listPath, 'utf8'));
  const groups = planBrowserShards(tests, requestedGroups);
  writeBrowserShardFiles(groups, outputDirectory);

  const maxEstimatedSeconds = Math.max(...groups.map(group => group.estimatedSeconds));
  process.stdout.write(JSON.stringify({
    total: groups.length,
    shards: groups.map(group => group.id),
    testCount: tests.length,
    maxEstimatedSeconds,
  }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2));
}
