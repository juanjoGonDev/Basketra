import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const includes = process.argv.slice(2);
if (includes.length === 0) throw new Error('At least one production coverage path is required');

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: 'utf8',
    stdio: options.capture ? 'pipe' : 'inherit',
    shell: false,
    ...options,
  });
  if (result.status !== 0) {
    const details = options.capture ? `${result.stdout || ''}${result.stderr || ''}` : '';
    throw new Error(`${command} ${args.join(' ')} failed${details ? `\n${details}` : ''}`);
  }
  return options.capture ? String(result.stdout || '').trim() : '';
}

function resolveBaseSha() {
  if (process.env['BASKETRA_COVERAGE_BASE']) return process.env['BASKETRA_COVERAGE_BASE'];
  if (process.env['GITHUB_EVENT_PATH']) {
    const event = JSON.parse(readFileSync(process.env['GITHUB_EVENT_PATH'], 'utf8'));
    const baseSha = event?.pull_request?.base?.sha;
    if (typeof baseSha === 'string' && /^[a-f0-9]{40}$/u.test(baseSha)) return baseSha;
  }
  try {
    return run('git', ['merge-base', 'main', 'HEAD'], { capture: true });
  } catch {
    return run('git', ['rev-parse', 'HEAD^1'], { capture: true });
  }
}

function ensureCommit(sha) {
  const available = spawnSync('git', ['cat-file', '-e', `${sha}^{commit}`], {
    cwd: root,
    stdio: 'ignore',
    shell: false,
  }).status === 0;
  if (!available) run('git', ['fetch', '--no-tags', '--depth=1', 'origin', sha]);
}

function changedLines(baseSha) {
  const diff = run('git', [
    'diff',
    '--unified=0',
    '--diff-filter=ACMR',
    baseSha,
    'HEAD',
    '--',
    ...includes,
  ], { capture: true });
  const result = new Map();
  let file = '';
  for (const line of diff.split('\n')) {
    if (line.startsWith('+++ b/')) {
      file = line.slice(6);
      if (!result.has(file)) result.set(file, new Set());
      continue;
    }
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/u.exec(line);
    if (!file || !hunk) continue;
    const start = Number(hunk[1]);
    const count = hunk[2] === undefined ? 1 : Number(hunk[2]);
    const lines = result.get(file);
    for (let offset = 0; offset < count; offset += 1) lines.add(start + offset);
  }
  return result;
}

function parseLcov(content) {
  const records = new Map();
  let current;
  for (const line of content.split('\n')) {
    if (line.startsWith('SF:')) {
      const absolute = resolve(line.slice(3));
      const file = relative(root, absolute).replaceAll('\\', '/');
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
        block,
        branch,
        count: taken === '-' ? 0 : Number(taken),
      });
      continue;
    }
    if (line === 'end_of_record') current = undefined;
  }
  return records;
}

function checkCoverage(changes, records) {
  const failures = [];
  let linesFound = 0;
  let functionsFound = 0;
  let branchesFound = 0;

  for (const [file, changed] of changes) {
    const coverage = records.get(file);
    if (!coverage) {
      failures.push(`${file}: no coverage record`);
      continue;
    }

    for (const line of changed) {
      if (!coverage.lines.has(line)) continue;
      linesFound += 1;
      if ((coverage.lines.get(line) || 0) === 0) failures.push(`${file}:${line} uncovered line`);
    }

    for (const [name, line] of coverage.functionLines) {
      if (!changed.has(line)) continue;
      functionsFound += 1;
      if ((coverage.functionCounts.get(name) || 0) === 0) failures.push(`${file}:${line} uncovered function ${name}`);
    }

    for (const branch of coverage.branches) {
      if (!changed.has(branch.line)) continue;
      branchesFound += 1;
      if (branch.count === 0) failures.push(`${file}:${branch.line} uncovered branch ${branch.block}/${branch.branch}`);
    }
  }

  if (linesFound === 0) failures.push('No executable changed lines were found in the coverage report');
  if (failures.length > 0) {
    throw new Error(`Changed-code coverage failed:\n${failures.map(value => `- ${value}`).join('\n')}`);
  }
  console.log(`Changed-code coverage passed: ${linesFound} lines, ${functionsFound} functions, ${branchesFound} branches at 100%.`);
}

const baseSha = resolveBaseSha();
ensureCommit(baseSha);
const changes = changedLines(baseSha);
if (changes.size === 0) {
  console.log('No production changes matched the requested coverage paths.');
  process.exit(0);
}

const directory = mkdtempSync(join(tmpdir(), 'basketra-diff-coverage-'));
const lcovPath = join(directory, 'lcov.info');
try {
  run('node', [
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
  checkCoverage(changes, records);
} finally {
  rmSync(directory, { recursive: true, force: true });
}
