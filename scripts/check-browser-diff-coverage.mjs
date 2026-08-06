import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import v8ToIstanbul from 'v8-to-istanbul';
import {
  changedCoverageLines,
  checkChangedCoverage,
  coverageRoot,
  ensureCoverageCommit,
  resolveCoverageBaseSha,
} from './diff-coverage-core.mjs';

const COVERAGE_DIRECTORY = resolve('.coverage/browser');
const SOURCE_BY_PATHNAME = new Map([
  ['/operations.js', 'src/web/operations.js'],
  ['/receipts.js', 'src/web/receipts.js'],
]);
const includes = [...SOURCE_BY_PATHNAME.values()];

function locationKey(location) {
  return [
    location.start.line,
    location.start.column,
    location.end.line,
    location.end.column,
  ].join(':');
}

function emptyAggregate() {
  return {
    statements: new Map(),
    functions: new Map(),
    branches: new Map(),
  };
}

function addIstanbulRecord(aggregate, record) {
  for (const [id, location] of Object.entries(record.statementMap)) {
    const key = locationKey(location);
    const previous = aggregate.statements.get(key) || { location, count: 0 };
    previous.count += Number(record.s[id] || 0);
    aggregate.statements.set(key, previous);
  }

  for (const [id, metadata] of Object.entries(record.fnMap)) {
    const location = metadata.decl || metadata.loc;
    const key = `${metadata.name}:${locationKey(location)}`;
    const previous = aggregate.functions.get(key) || {
      name: metadata.name,
      location,
      count: 0,
    };
    previous.count += Number(record.f[id] || 0);
    aggregate.functions.set(key, previous);
  }

  for (const [id, metadata] of Object.entries(record.branchMap)) {
    const counts = record.b[id] || [];
    metadata.locations.forEach((location, index) => {
      const key = `${metadata.type}:${locationKey(location)}:${index}`;
      const previous = aggregate.branches.get(key) || {
        location,
        id: key,
        count: 0,
      };
      previous.count += Number(counts[index] || 0);
      aggregate.branches.set(key, previous);
    });
  }
}

function normalizedRecord(aggregate) {
  const statementsByLine = new Map();
  for (const statement of aggregate.statements.values()) {
    const line = statement.location.start.line;
    const counts = statementsByLine.get(line) || [];
    counts.push(statement.count);
    statementsByLine.set(line, counts);
  }

  return {
    lines: new Map([...statementsByLine].map(([line, counts]) => [line, Math.min(...counts)])),
    functions: [...aggregate.functions.values()].map(entry => ({
      name: entry.name,
      line: entry.location.start.line,
      count: entry.count,
    })),
    branches: [...aggregate.branches.values()].map(entry => ({
      line: entry.location.start.line,
      id: entry.id,
      count: entry.count,
    })),
  };
}

async function convertEntry(entry, file) {
  const sourcePath = resolve(coverageRoot, file);
  const converter = v8ToIstanbul(
    sourcePath,
    0,
    typeof entry.source === 'string' ? { source: entry.source } : undefined,
  );
  await converter.load();
  converter.applyCoverage(entry.functions);
  const converted = converter.toIstanbul();
  const record = converted[sourcePath]
    || converted[relative(coverageRoot, sourcePath)]
    || Object.values(converted)[0];
  if (!record) throw new Error(`Chromium coverage could not be converted for ${file}`);
  return record;
}

if (!existsSync(COVERAGE_DIRECTORY)) {
  throw new Error('Browser coverage directory is missing; run Playwright through coverage-fixture.mjs first');
}

const baseSha = resolveCoverageBaseSha();
ensureCoverageCommit(baseSha);
const changes = changedCoverageLines(baseSha, includes);
const aggregates = new Map(includes.map(file => [file, emptyAggregate()]));
let entryCount = 0;

for (const name of readdirSync(COVERAGE_DIRECTORY).filter(value => value.endsWith('.json'))) {
  const entries = JSON.parse(readFileSync(resolve(COVERAGE_DIRECTORY, name), 'utf8'));
  if (!Array.isArray(entries)) throw new Error(`Invalid browser coverage payload: ${name}`);
  for (const entry of entries) {
    if (!entry || typeof entry.url !== 'string' || !Array.isArray(entry.functions)) continue;
    const file = SOURCE_BY_PATHNAME.get(new URL(entry.url).pathname);
    if (!file) continue;
    addIstanbulRecord(aggregates.get(file), await convertEntry(entry, file));
    entryCount += 1;
  }
}

if (entryCount === 0) throw new Error('No Chromium coverage entries were recorded for the changed UI modules');
const records = new Map([...aggregates].map(([file, aggregate]) => [file, normalizedRecord(aggregate)]));
checkChangedCoverage(changes, records, 'Browser changed-code');
