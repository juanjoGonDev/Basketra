import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import {
  DEFAULT_ESTIMATED_SECONDS,
  normalizeTestListEntry,
  parsePlaywrightList,
  planBrowserShards,
  writeBrowserShardFiles,
} from '../../scripts/plan-browser-shards.mjs';

const heavyTitle = 'catalog product detail residuals cover rich history, relations and destructive outcomes';

function listing() {
  return [
    'Listing tests:',
    '  [chromium] › tests/browser/changed-code-residuals.spec.mjs:128:1 › ' + heavyTitle,
    '  [chromium] › example-a.spec.mjs:10:1 › quick A',
    '  [chromium] › tests/browser/example-b.spec.mjs:20:1 › quick B',
    '  [chromium] › tests/browser/example-c.spec.mjs:30:1 › quick C',
    'Total: 4 tests in 4 files',
    '',
  ].join('\n');
}

test('browser shard planner parses exact Playwright test-list entries and timing hints', () => {
  const tests = parsePlaywrightList(listing());
  assert.equal(tests.length, 4);
  assert.equal(
    normalizeTestListEntry(tests[0].entry),
    'tests/browser/changed-code-residuals.spec.mjs › ' + heavyTitle,
  );
  assert.equal(tests[0].estimatedSeconds, 18);
  assert.equal(normalizeTestListEntry(tests[1].entry), 'tests/browser/example-a.spec.mjs › quick A');
  assert.equal(tests[1].estimatedSeconds, DEFAULT_ESTIMATED_SECONDS);
});

test('browser shard planner greedily balances weighted tests using only the configured group count', () => {
  const tests = parsePlaywrightList(listing());
  const first = planBrowserShards(tests, 2);
  const second = planBrowserShards(tests, 2);
  assert.deepEqual(first, second);
  assert.equal(first.length, 2);
  assert.equal(first.flatMap(group => group.tests).length, tests.length);
  const heavyGroup = first.find(group => group.tests.some(item => item.key.includes(heavyTitle)));
  assert.equal(heavyGroup.tests.length, 1);
});

test('browser shard planner writes valid Playwright test-list files', () => {
  const directory = mkdtempSync(join(tmpdir(), 'basketra-browser-shards-'));
  try {
    const groups = planBrowserShards(parsePlaywrightList(listing()), 2);
    writeBrowserShardFiles(groups, directory);
    for (const group of groups) {
      const content = readFileSync(join(directory, 'shard-' + group.id + '.txt'), 'utf8');
      assert.equal(content, group.tests.map(item => item.entry).join('\n') + '\n');
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('browser shard planner rejects invalid configured group counts', () => {
  const tests = parsePlaywrightList(listing());
  assert.throws(() => planBrowserShards(tests, 0), /between 1 and 256/u);
  assert.throws(() => planBrowserShards(tests, 257), /between 1 and 256/u);
});
