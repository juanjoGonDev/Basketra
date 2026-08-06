import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import {
  changedCoverageLines,
  checkChangedCoverage,
  coverageRoot,
  ensureCoverageCommit,
  resolveCoverageBaseSha,
  runCommand,
} from './diff-coverage-core.mjs';

const includes = process.argv.slice(2);
if (includes.length === 0) throw new Error('At least one production coverage path is required');

function parseLcov(content) {
  const records = new Map();
  let current;
  for (const line of content.split('\n')) {
    if (line.startsWith('SF:')) {
      const absolute = resolve(line.slice(3));
      const file = relative(coverageRoot, absolute).replaceAll('\\', '/');
      current = { lines: new Map(), functionLines: new Map(), functionCounts: new Map(), branches: [] };
      records.set(file, current);
      continue;
    }
    if (!current) continue;
    if (line.startsWith('DA:')) {
      const [lineNumber, count] = line.slice(3).split(',');
      current.lines.set(Number(lineNumber), Number(count));
      continue;
    }
    if (line.startsWith('FN:')) {
      const separator = line.indexOf(',', 3);
      const lineNumber = Number(line.slice(3, separator));
      const name = line.slice(separator + 1);
      current.functionLines.set(name, lineNumber);
      continue;
    }
    if (line.startsWith('FNDA:')) {
      const separator = line.indexOf(',', 5);
      const count = Number(line.slice(5, separator));
      const name = line.slice(separator + 1);
      current.functionCounts.set(name, count);
      continue;
    }
    if (line.startsWith('BRDA:')) {
      const [lineNumber, block, branch, taken] = line.slice(5).split(',');
      current.branches.push({
        line: Number(lineNumber),
        id: `${block}/${branch}`,
        count: taken === '-' ? 0 : Number(taken),
      });
      continue;
    }
    if (line === 'end_of_record') current = undefined;
  }

  const normalized = new Map();
  for (const [file, record] of records) {
    normalized.set(file, {
      lines: record.lines,
      functions: [...record.functionLines].map(([name, line]) => ({
        name,
        line,
        count: record.functionCounts.get(name) || 0,
      })),
      branches: record.branches,
    });
  }
  return normalized;
}

const baseSha = resolveCoverageBaseSha();
ensureCoverageCommit(baseSha);
const changes = changedCoverageLines(baseSha, includes);
if (changes.size === 0) {
  console.log('No production changes matched the requested coverage paths.');
  process.exit(0);
}

const directory = mkdtempSync(join(tmpdir(), 'basketra-diff-coverage-'));
const lcovPath = join(directory, 'lcov.info');
try {
  runCommand('node', [
    '--experimental-strip-types',
    '--experimental-test-coverage',
    ...includes.map(file => `--test-coverage-include=${file}`),
    '--test-reporter=spec',
    '--test-reporter-destination=stdout',
    '--test-reporter=lcov',
    `--test-reporter-destination=${lcovPath}`,
    '--test',
    '--test-concurrency=1',
    'tests/unit/*.test.ts',
    'tests/integration/*.test.ts',
    'tests/e2e/*.test.ts',
  ]);
  const records = parseLcov(readFileSync(lcovPath, 'utf8'));
  checkChangedCoverage(changes, records);
} finally {
  rmSync(directory, { recursive: true, force: true });
}
