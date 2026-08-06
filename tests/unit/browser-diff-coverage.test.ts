import assert from 'node:assert/strict';
import test from 'node:test';

import {
  aggregateInheritedRangeCount,
  inheritedRangeCount,
  requiresBrowserDiffCoverage,
} from '../../scripts/check-browser-diff-coverage.mjs';
import { coverageBaseShaFromEvent } from '../../scripts/diff-coverage-core.mjs';

const root = { startOffset: 0, endOffset: 100, count: 1 };
const candidate = { startOffset: 20, endOffset: 40, count: 0 };
const pullRequestBase = '1'.repeat(40);
const pushBefore = '2'.repeat(40);

test('inherits the parent counter when V8 omits an executed alternative', () => {
  const runs = [
    [root, candidate],
    [root],
  ];

  assert.equal(aggregateInheritedRangeCount(runs, candidate), 1);
});

test('keeps a branch uncovered when every run reports its explicit zero range', () => {
  const runs = [
    [root, candidate],
    [root, candidate],
  ];

  assert.equal(aggregateInheritedRangeCount(runs, candidate), 0);
});

test('inherits from the smallest containing range rather than the function root', () => {
  const nestedParent = { startOffset: 10, endOffset: 50, count: 0 };

  assert.equal(inheritedRangeCount([root, nestedParent], candidate), 0);
});

test('uses an exact range counter when the candidate is present', () => {
  const executed = { ...candidate, count: 3 };

  assert.equal(inheritedRangeCount([root, executed], candidate), 3);
});

test('returns zero when no recorded range owns the candidate', () => {
  const outside = { startOffset: 120, endOffset: 140, count: 0 };

  assert.equal(inheritedRangeCount([root], outside), 0);
});

test('skips browser diff coverage when no tracked browser module changed', () => {
  assert.equal(requiresBrowserDiffCoverage(new Map()), false);
});

test('requires browser diff coverage when a tracked browser module changed', () => {
  assert.equal(requiresBrowserDiffCoverage(new Map([
    ['src/web/receipts.js', new Set([10])],
  ])), true);
});

test('uses the pull-request base before any push metadata', () => {
  assert.equal(coverageBaseShaFromEvent({
    before: pushBefore,
    pull_request: { base: { sha: pullRequestBase } },
  }), pullRequestBase);
});

test('uses the previous commit from a push event', () => {
  assert.equal(coverageBaseShaFromEvent({ before: pushBefore }), pushBefore);
});

test('rejects zero and malformed event commit identifiers', () => {
  assert.equal(coverageBaseShaFromEvent({ before: '0'.repeat(40) }), undefined);
  assert.equal(coverageBaseShaFromEvent({ before: 'not-a-commit' }), undefined);
  assert.equal(coverageBaseShaFromEvent({}), undefined);
});
