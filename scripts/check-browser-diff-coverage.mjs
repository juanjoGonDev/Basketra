import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  changedCoverageLines,
  checkChangedCoverage,
  ensureCoverageCommit,
  resolveCoverageBaseSha,
} from './diff-coverage-core.mjs';

const COVERAGE_DIRECTORY = resolve('.coverage/browser');
const SOURCE_BY_PATHNAME = new Map([
  ['/operations.js', 'src/web/operations.js'],
  ['/receipts.js', 'src/web/receipts.js'],
]);
const includes = [...SOURCE_BY_PATHNAME.values()];

function emptyAggregate(file) {
  return {
    source: readFileSync(resolve(file), 'utf8'),
    ranges: new Map(),
    functions: new Map(),
    branches: new Map(),
  };
}

function rangeKey(range) {
  return `${range.startOffset}:${range.endOffset}`;
}

function addRange(target, range, count) {
  const key = rangeKey(range);
  const previous = target.get(key) || {
    startOffset: range.startOffset,
    endOffset: range.endOffset,
    count: 0,
  };
  previous.count += Number(count || 0);
  target.set(key, previous);
}

function addV8Entry(aggregate, entry) {
  for (const functionCoverage of entry.functions) {
    if (!Array.isArray(functionCoverage.ranges) || functionCoverage.ranges.length === 0) continue;
    const root = functionCoverage.ranges[0];
    const functionKey = `${functionCoverage.functionName || '<anonymous>'}:${rangeKey(root)}`;
    const previous = aggregate.functions.get(functionKey) || {
      name: functionCoverage.functionName || '<anonymous>',
      startOffset: root.startOffset,
      endOffset: root.endOffset,
      count: 0,
    };
    previous.count += Number(root.count || 0);
    aggregate.functions.set(functionKey, previous);

    for (const range of functionCoverage.ranges) addRange(aggregate.ranges, range, range.count);
    for (const range of functionCoverage.ranges.slice(1)) addRange(aggregate.branches, range, range.count);
  }
}

function lineOffsets(source) {
  const offsets = [0];
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] === '\n') offsets.push(index + 1);
  }
  offsets.push(source.length + 1);
  return offsets;
}

function offsetLine(offsets, offset) {
  let low = 0;
  let high = offsets.length - 1;
  while (low + 1 < high) {
    const middle = Math.floor((low + high) / 2);
    if (offsets[middle] <= offset) low = middle;
    else high = middle;
  }
  return low + 1;
}

function lineCoverageCount(source, offsets, ranges, line) {
  const start = offsets[line - 1];
  const end = offsets[line] - 1;
  if (start === undefined || end < start) return undefined;
  const text = source.slice(start, end);
  const trimmed = text.trim();
  if (!trimmed || /^(?:\/\/|\/\*|\*|\*\/)/u.test(trimmed)) return undefined;

  const containing = [...ranges.values()].filter(range => (
    range.startOffset <= start && end <= range.endOffset
  ));
  if (containing.length === 0) return undefined;
  return Math.max(...containing.map(range => range.count));
}

function normalizedRecord(aggregate, changed) {
  const offsets = lineOffsets(aggregate.source);
  const lines = new Map();
  for (const line of changed) {
    const count = lineCoverageCount(aggregate.source, offsets, aggregate.ranges, line);
    if (count !== undefined) lines.set(line, count);
  }

  const functions = [...aggregate.functions.values()].map(entry => ({
    name: entry.name,
    line: offsetLine(offsets, entry.startOffset),
    count: entry.count,
  }));

  const branches = [...aggregate.branches.values()].map(entry => ({
    line: offsetLine(offsets, entry.startOffset),
    id: `${entry.startOffset}:${entry.endOffset}`,
    count: entry.count,
  }));

  return { lines, functions, branches };
}

if (!existsSync(COVERAGE_DIRECTORY)) {
  throw new Error('Browser coverage directory is missing; run Playwright through coverage-fixture.mjs first');
}

const baseSha = resolveCoverageBaseSha();
ensureCoverageCommit(baseSha);
const changes = changedCoverageLines(baseSha, includes);
const aggregates = new Map(includes.map(file => [file, emptyAggregate(file)]));
let entryCount = 0;

for (const name of readdirSync(COVERAGE_DIRECTORY).filter(value => value.endsWith('.json'))) {
  const entries = JSON.parse(readFileSync(resolve(COVERAGE_DIRECTORY, name), 'utf8'));
  if (!Array.isArray(entries)) throw new Error(`Invalid browser coverage payload: ${name}`);
  for (const entry of entries) {
    if (!entry || typeof entry.url !== 'string' || !Array.isArray(entry.functions)) continue;
    const file = SOURCE_BY_PATHNAME.get(new URL(entry.url).pathname);
    if (!file) continue;
    addV8Entry(aggregates.get(file), entry);
    entryCount += 1;
  }
}

if (entryCount === 0) throw new Error('No Chromium coverage entries were recorded for the changed UI modules');
const records = new Map([...aggregates].map(([file, aggregate]) => [
  file,
  normalizedRecord(aggregate, changes.get(file) || new Set()),
]));
checkChangedCoverage(changes, records, 'Browser changed-code');
