import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const workflow = readFileSync('.github/workflows/ci.yml', 'utf8');
const playwrightConfig = readFileSync('playwright.config.mjs', 'utf8');
const coverageReporter = readFileSync('tests/browser/coverage-reporter.mjs', 'utf8');

test('pull request quality decomposes the canonical serial gate into bounded parallel groups', () => {
  for (const command of [
    'pnpm format:check && pnpm lint && pnpm typecheck && pnpm deadcode && pnpm deps:check',
    'pnpm test',
    'pnpm test:integration',
    'pnpm test:e2e',
    'pnpm test:coverage',
    'pnpm test:coverage:receipt-ai-backend',
    'pnpm test:coverage:receipt-ai-recovery && pnpm test:coverage:service-worker',
    'pnpm build',
    'pnpm resource:measure',
  ]) {
    assert.ok(workflow.includes(command), `missing CI quality group: ${command}`);
  }
  assert.doesNotMatch(workflow, /run:\s+pnpm quality/u);
  assert.match(workflow, /quality:\n[\s\S]*?timeout-minutes:\s*1/u);
});

test('browser runtime is primed once and every deterministic shard has the one-minute budget', () => {
  assert.match(workflow, /browser-runtime:\n[\s\S]*?timeout-minutes:\s*1/u);
  assert.match(workflow, /actions\/cache@55cc8345863c7cc4c66a329aec7e433d2d1c52a9/u);
  assert.match(workflow, /basketra-playwright-\$\{\{ runner\.os \}\}-1\.59\.1-\$\{\{ github\.event\.pull_request\.head\.sha \}\}/u);
  assert.match(workflow, /outputs:\n\s+shards: \$\{\{ steps\.shard-plan\.outputs\.shards \}\}\n\s+total: \$\{\{ steps\.shard-plan\.outputs\.total \}\}/u);
  assert.match(workflow, /maximum two tests per shard/u);
  assert.match(workflow, /shard: \$\{\{ fromJSON\(needs\.browser-runtime\.outputs\.shards\) \}\}/u);
  assert.match(workflow, /name: "🌐 Browser \$\{\{ matrix\.shard \}\}\/\$\{\{ needs\.browser-runtime\.outputs\.total \}\}"/u);
  assert.match(workflow, /pnpm exec playwright test --shard=\$\{\{ matrix\.shard \}\}\/\$\{\{ needs\.browser-runtime\.outputs\.total \}\}/u);
  assert.match(workflow, /BASKETRA_BROWSER_COVERAGE_COLLECT_ONLY:\s*"1"/u);
  assert.match(workflow, /name:\s+basketra-browser-runtime/u);
  assert.match(workflow, /BASKETRA_BROWSER_PREBUILT:\s*"1"/u);
  assert.doesNotMatch(workflow, /playwright install-deps/u);
});

test('browser sharding reuses one prebuilt application and keeps one isolated worker per shard', () => {
  const startServer = readFileSync('tests/browser/start-server.mjs', 'utf8');
  assert.match(startServer, /BASKETRA_BROWSER_PREBUILT/u);
  assert.match(startServer, /requires dist\/main\.js/u);
  assert.match(playwrightConfig, /fullyParallel:\s*true/u);
  assert.match(playwrightConfig, /workers:\s*1/u);
  assert.match(playwrightConfig, /trace:\s*inCi \? 'retain-on-failure' : 'on'/u);
  assert.match(playwrightConfig, /video:\s*inCi \? 'retain-on-failure' : 'on'/u);
});

test('changed-code browser coverage is collected per shard and enforced once after aggregation', () => {
  assert.match(coverageReporter, /BASKETRA_BROWSER_COVERAGE_COLLECT_ONLY/u);
  assert.match(coverageReporter, /result\.status !== 'passed' \|\| COLLECT_ONLY/u);
  assert.match(workflow, /name:\s+basketra-browser-shard-\$\{\{ matrix\.shard \}\}/u);
  assert.match(workflow, /--pattern 'basketra-browser-shard-\*'/u);
  assert.match(workflow, /include-hidden-files:\s*true/u);
  assert.match(workflow, /compression-level:\s*0/u);
  assert.match(workflow, /node scripts\/check-browser-diff-coverage\.mjs/u);
});

test('browser output uses one low-overhead artifact per shard', () => {
  assert.match(workflow, /name:\s+basketra-browser-shard-\$\{\{ matrix\.shard \}\}/u);
  assert.match(workflow, /\.coverage\/browser\n\s+test-results/u);
  assert.doesNotMatch(workflow, /basketra-invoice-visual-evidence|basketra-category-visual-evidence|basketra-visual-screenshot-evidence/u);
});
