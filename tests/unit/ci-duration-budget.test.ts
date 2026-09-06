import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const ci = readFileSync('.github/workflows/ci.yml', 'utf8');
const codeql = readFileSync('.github/workflows/codeql.yml', 'utf8');

test('repository-controlled pull request jobs enforce a one-minute timeout', () => {
  const timeoutValues = [...ci.matchAll(/timeout-minutes:\s*(\d+)/gu)].map(match => Number(match[1]));
  assert.ok(timeoutValues.length >= 7);
  assert.deepEqual(new Set(timeoutValues), new Set([1]));
});

test('CodeQL remains enabled for both security languages under the same one-minute budget', () => {
  assert.match(codeql, /- actions\n\s+- javascript-typescript/u);
  assert.match(codeql, /timeout-minutes:\s*1/u);
  assert.match(codeql, /config-file:\s+\.\/\.github\/codeql\/codeql-config\.yml/u);
});
