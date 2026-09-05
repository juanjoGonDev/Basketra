import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
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
  ['/app.js', 'src/web/app.js'],
  ['/catalog.js', 'src/web/catalog.js'],
  ['/inventory.js', 'src/web/inventory.js'],
  ['/ui.js', 'src/web/ui.js'],
]);
const includes = [...SOURCE_BY_PATHNAME.values()];

function emptyAggregate(file) {
  return {
    source: readFileSync(resolve(file), 'utf8'),
    functions: new Map(),
  };
}

function rangeKey(range) {
  return `${range.startOffset}:${range.endOffset}`;
}

function normalizedRanges(ranges) {
  return ranges.map(range => ({
    startOffset: range.startOffset,
    endOffset: range.endOffset,
    count: Number(range.count || 0),
  }));
}

function addV8Entry(aggregate, entry) {
  for (const functionCoverage of entry.functions) {
    if (!Array.isArray(functionCoverage.ranges) || functionCoverage.ranges.length === 0) continue;
    const ranges = normalizedRanges(functionCoverage.ranges);
    const root = ranges[0];
    const functionKey = `${functionCoverage.functionName || '<anonymous>'}:${rangeKey(root)}`;
    const current = aggregate.functions.get(functionKey) || {
      name: functionCoverage.functionName || '<anonymous>',
      startOffset: root.startOffset,
      endOffset: root.endOffset,
      count: 0,
      runs: [],
      branches: new Map(),
    };
    current.count += root.count;
    current.runs.push(ranges);
    for (const range of ranges.slice(1)) current.branches.set(rangeKey(range), range);
    aggregate.functions.set(functionKey, current);
  }
}

export function inheritedRangeCount(ranges, candidate) {
  const exact = ranges.find(range => (
    range.startOffset === candidate.startOffset && range.endOffset === candidate.endOffset
  ));
  if (exact) return exact.count;

  const containing = ranges.filter(range => (
    range.startOffset <= candidate.startOffset && candidate.endOffset <= range.endOffset
  ));
  if (containing.length === 0) return 0;
  const smallestSpan = Math.min(...containing.map(range => range.endOffset - range.startOffset));
  return Math.min(...containing
    .filter(range => range.endOffset - range.startOffset === smallestSpan)
    .map(range => range.count));
}

export function aggregateInheritedRangeCount(runs, candidate) {
  return runs.reduce((total, ranges) => total + inheritedRangeCount(ranges, candidate), 0);
}

export function requiresBrowserDiffCoverage(changes) {
  return changes.size > 0;
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

function executableOffset(source, offsets, line) {
  const start = offsets[line - 1];
  const end = offsets[line] - 1;
  if (start === undefined || end < start) return undefined;
  const text = source.slice(start, end);
  const trimmed = text.trim();
  if (!trimmed || /^(?:\/\/|\/\*|\*|\*\/)/u.test(trimmed)) return undefined;
  const first = text.search(/\S/u);
  return first < 0 ? undefined : start + first;
}

function functionAtOffset(functions, offset) {
  const containing = [...functions.values()].filter(entry => (
    entry.startOffset <= offset && offset < entry.endOffset
  ));
  if (containing.length === 0) return undefined;
  const smallestSpan = Math.min(...containing.map(entry => entry.endOffset - entry.startOffset));
  return containing.find(entry => entry.endOffset - entry.startOffset === smallestSpan);
}

function normalizedRecord(aggregate, changed) {
  const offsets = lineOffsets(aggregate.source);
  const lines = new Map();
  for (const line of changed) {
    const offset = executableOffset(aggregate.source, offsets, line);
    if (offset === undefined) continue;
    const owner = functionAtOffset(aggregate.functions, offset);
    if (!owner) continue;
    lines.set(line, aggregateInheritedRangeCount(owner.runs, {
      startOffset: offset,
      endOffset: offset + 1,
    }));
  }

  const functions = [...aggregate.functions.values()].map(entry => ({
    name: entry.name,
    line: offsetLine(offsets, entry.startOffset),
    count: entry.count,
  }));

  const branches = [...aggregate.functions.values()].flatMap(entry => (
    [...entry.branches.values()].map(branch => ({
      line: offsetLine(offsets, branch.startOffset),
      id: `${branch.startOffset}:${branch.endOffset}`,
      count: aggregateInheritedRangeCount(entry.runs, branch),
    }))
  ));

  return { lines, functions, branches };
}

function main() {
  const baseSha = resolveCoverageBaseSha();
  ensureCoverageCommit(baseSha);
  const changes = changedCoverageLines(baseSha, includes);
  if (!requiresBrowserDiffCoverage(changes)) {
    console.log('No browser production changes matched the changed-code coverage paths.');
    return;
  }

  if (!existsSync(COVERAGE_DIRECTORY)) {
    throw new Error('Browser coverage directory is missing; run Playwright through coverage-fixture.mjs first');
  }

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
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : '';
if (import.meta.url === invokedPath) main();
