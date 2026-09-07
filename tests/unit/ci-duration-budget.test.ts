import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const ci = readFileSync('.github/workflows/ci.yml', 'utf8');
const codeql = readFileSync('.github/workflows/codeql.yml', 'utf8');

test('every pull-request CI job has a hard one-minute envelope', () => {
  const timeoutValues = [...ci.matchAll(/timeout-minutes:\s*(\d+)/gu)].map(match => Number(match[1]));
  assert.ok(timeoutValues.length >= 7);
  assert.deepEqual(new Set(timeoutValues), new Set([1]));
  assert.match(ci, /browser-e2e:\n[\s\S]*?timeout-minutes:\s*1/u);
  assert.match(ci, /timeout --signal=TERM --kill-after=5s 45s pnpm exec playwright test --test-list=/u);
});

test('CodeQL keeps both security languages inside the same one-minute envelope', () => {
  assert.match(codeql, /- actions\n\s+- javascript-typescript/u);
  assert.match(codeql, /timeout-minutes:\s*1/u);
  assert.match(codeql, /config-file:\s+\.\/\.github\/codeql\/codeql-config\.yml/u);
  assert.match(codeql, /sparse-checkout:\s*\|[\s\S]*?\.github[\s\S]*?scripts[\s\S]*?src/u);
  assert.doesNotMatch(codeql, /\n\s+tests\n/u);
});
