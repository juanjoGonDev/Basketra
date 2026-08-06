import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

export const coverageRoot = process.cwd();

export function runCommand(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: coverageRoot,
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

export function resolveCoverageBaseSha() {
  if (process.env['BASKETRA_COVERAGE_BASE']) return process.env['BASKETRA_COVERAGE_BASE'];
  if (process.env['GITHUB_EVENT_PATH']) {
    const event = JSON.parse(readFileSync(process.env['GITHUB_EVENT_PATH'], 'utf8'));
    const baseSha = event?.pull_request?.base?.sha;
    if (typeof baseSha === 'string' && /^[a-f0-9]{40}$/u.test(baseSha)) return baseSha;
  }
  try {
    return runCommand('git', ['merge-base', 'main', 'HEAD'], { capture: true });
  } catch {
    return runCommand('git', ['rev-parse', 'HEAD^1'], { capture: true });
  }
}

export function ensureCoverageCommit(sha) {
  const available = spawnSync('git', ['cat-file', '-e', `${sha}^{commit}`], {
    cwd: coverageRoot,
    stdio: 'ignore',
    shell: false,
  }).status === 0;
  if (!available) runCommand('git', ['fetch', '--no-tags', '--depth=1', 'origin', sha]);
}

export function changedCoverageLines(baseSha, includes) {
  const diff = runCommand('git', [
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

export function checkChangedCoverage(changes, records, label = 'Changed-code') {
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

    for (const entry of coverage.functions) {
      if (!changed.has(entry.line)) continue;
      functionsFound += 1;
      if (entry.count === 0) failures.push(`${file}:${entry.line} uncovered function ${entry.name}`);
    }

    for (const branch of coverage.branches) {
      if (!changed.has(branch.line)) continue;
      branchesFound += 1;
      if (branch.count === 0) failures.push(`${file}:${branch.line} uncovered branch ${branch.id}`);
    }
  }

  if (linesFound === 0) failures.push('No executable changed lines were found in the coverage report');
  if (failures.length > 0) {
    throw new Error(`${label} coverage failed:\n${failures.map(value => `- ${value}`).join('\n')}`);
  }
  console.log(`${label} coverage passed: ${linesFound} lines, ${functionsFound} functions, ${branchesFound} branches at 100%.`);
}
