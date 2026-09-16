import { readFileSync } from 'node:fs';

// TEMPORARY diagnostic reporter (removed before delivery).
// Publishes readable Playwright failures as check-run annotations, because job logs cannot be
// downloaded from the diagnosis environment.
const [reportPath, label = 'browser'] = process.argv.slice(2);
const report = JSON.parse(readFileSync(reportPath, 'utf8'));
const failures = [];

function clean(message) {
  return String(message || 'no message').replace(/\u001b\[[0-9;]*m/gu, '');
}

function walk(suite, parentTitle) {
  const title = [parentTitle, suite.title].filter(Boolean).join(' > ');
  for (const spec of suite.specs || []) {
    for (const testCase of spec.tests || []) {
      for (const result of testCase.results || []) {
        if (result.status !== 'failed' && result.status !== 'timedOut') continue;
        failures.push(`${title} > ${spec.title}\n${clean(result.error?.message || result.errors?.[0]?.message)}`);
      }
    }
  }
  for (const child of suite.suites || []) walk(child, title);
}

for (const suite of report.suites || []) walk(suite, suite.file || '');

const summary = failures.length === 0
  ? `${label}: every selected test passed (${report.stats?.expected ?? 0} expected)`
  : `${label}: ${failures.length} failure(s)\n\n${failures.join('\n\n---\n\n')}`;
const slice = summary.slice(0, 6000)
  .replaceAll('%', '%25')
  .replaceAll('\r', '%0D')
  .replaceAll('\n', '%0A');
const level = failures.length === 0 ? 'notice' : 'error';
process.stdout.write(`::${level} title=${label}::${slice}\n`);
