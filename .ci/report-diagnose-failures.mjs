import { existsSync, readFileSync } from 'node:fs';

const REPORT = '.ci/diagnose-report.json';

function strip(value) {
  return String(value ?? '').replace(/\u001b\[[0-9;]*m/gu, '').replace(/\r/gu, '');
}

function encodeMessage(value) {
  return strip(value).replaceAll('%', '%25').replaceAll('\n', '%0A');
}

function encodeTitle(value) {
  return encodeMessage(value).replaceAll(',', '%2C').replaceAll(':', '%3A');
}

if (!existsSync(REPORT)) {
  console.log('::error title=diagnostic report missing::Playwright produced no JSON report; the run failed before reporting.');
  process.exit(0);
}

const report = JSON.parse(readFileSync(REPORT, 'utf8'));
const failures = [];

function walk(suite, parents) {
  const titles = suite.title ? [...parents, suite.title] : parents;
  for (const spec of suite.specs ?? []) {
    for (const testCase of spec.tests ?? []) {
      for (const result of testCase.results ?? []) {
        if (result.status === 'passed') continue;
        const messages = (result.errors ?? [])
          .map(error => strip(error.message || error.snippet || ''))
          .filter(Boolean);
        failures.push({
          file: spec.file ?? suite.file ?? 'tests/browser/unknown.spec.mjs',
          line: spec.line ?? 1,
          title: [...titles, spec.title].filter(Boolean).join(' > '),
          status: result.status,
          duration: result.duration ?? 0,
          message: messages.join('\n----- next error -----\n') || `no error message recorded (status ${result.status})`,
        });
      }
    }
  }
  for (const child of suite.suites ?? []) walk(child, titles);
}

for (const suite of report.suites ?? []) walk(suite, []);

const stats = report.stats ?? {};
console.log(`Diagnosed ${failures.length} non-passing results (unexpected ${stats.unexpected ?? 0}, expected ${stats.expected ?? 0}).`);

for (const error of report.errors ?? []) {
  console.log(`::error title=${encodeTitle('global Playwright error')}::${encodeMessage(strip(error.message ?? '').slice(0, 3000))}`);
}

for (const failure of failures.slice(0, 40)) {
  const title = `${failure.status} after ${failure.duration}ms - ${failure.title}`;
  console.log(`::error title=${encodeTitle(title)},file=${failure.file},line=${failure.line}::${encodeMessage(failure.message.slice(0, 3000))}`);
}

if (failures.length === 0) console.log('No failures were recorded in the diagnostic report.');
