import assert from 'node:assert/strict';
import test from 'node:test';

import {
  aggregateInheritedRangeCount,
  inheritedRangeCount,
} from '../../scripts/check-browser-diff-coverage.mjs';

const root = { startOffset: 0, endOffset: 100, count: 1 };
const candidate = { startOffset: 20, endOffset: 40, count: 0 };

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
