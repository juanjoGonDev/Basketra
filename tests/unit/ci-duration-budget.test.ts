import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const ci = readFileSync('.github/workflows/ci.yml', 'utf8');
const codeql = readFileSync('.github/workflows/codeql.yml', 'utf8');

test('workload jobs stay at one minute while the final verifier may wait for global CI state', () => {
  const timeoutValues = [...ci.matchAll(/timeout-minutes:\s*(\d+)/gu)].map(match => Number(match[1]));
  assert.equal(timeoutValues.filter(value => value === 1).length, 8);
  assert.equal(timeoutValues.filter(value => value === 15).length, 1);
  assert.deepEqual(new Set(timeoutValues), new Set([1, 15]));
  assert.match(ci, /browser-e2e:\n[\s\S]*?timeout-minutes:\s*1/u);
  assert.match(ci, /timeout --signal=TERM --kill-after=5s 45s pnpm exec playwright test --test-list=/u);

  const finalJob = ci.slice(ci.indexOf('\n  final:\n'));
  assert.match(finalJob, /name: "✅ CI complete"/u);
  assert.match(finalJob, /if: \$\{\{ always\(\) \}\}/u);
  assert.match(finalJob, /timeout-minutes:\s*15/u);
  assert.match(finalJob, /security-events:\s*read/u);
  assert.match(finalJob, /head_sha=\$HEAD_SHA&event=pull_request/u);
  assert.match(finalJob, /code-scanning\/analyses\?per_page=100/u);
  assert.ok(finalJob.includes("IFS=  assert.match(finalJob, /\.category == \$category/u);
  for (const dependency of [
    'quality',
    'integration',
    'security',
    'browser-runtime',
    'browser-e2e',
    'browser-coverage',
    'container',
    'container-smoke',
  ]) {
    assert.match(finalJob, new RegExp('\\n\\s+- ' + dependency + '\\n', 'u'));
  }
});

test('CodeQL keeps full language coverage through one-minute architecture scopes', () => {
  assert.match(codeql, /timeout-minutes:\s*1/u);
  assert.match(codeql, /wait-for-processing:\s*false/u);
  for (const scope of ['actions', 'backend-catalog', 'backend-platform', 'backend-operations', 'backend-receipt-runtime', 'backend-receipt-ai', 'web-commerce', 'web-receipts', 'automation']) {
    assert.match(codeql, new RegExp('scope: ' + scope, 'u'));
  }
  assert.equal((codeql.match(/language: javascript-typescript/gu) || []).length, 8);
  assert.match(codeql, /language: actions/u);
  assert.match(codeql, /config-file:\s+\$\{\{ matrix\.config \}\}/u);
  assert.match(codeql, /category:\s+\/language:\$\{\{ matrix\.language \}\}\/scope:\$\{\{ matrix\.scope \}\}/u);
  assert.doesNotMatch(codeql, /\n\s+tests\n/u);

  const actionsConfig = readFileSync('.github/codeql/codeql-actions.yml', 'utf8');
  const backendCatalogConfig = readFileSync('.github/codeql/codeql-backend-catalog.yml', 'utf8');
  const backendPlatformConfig = readFileSync('.github/codeql/codeql-backend-platform.yml', 'utf8');
  const backendOperationsConfig = readFileSync('.github/codeql/codeql-backend-operations.yml', 'utf8');
  const backendReceiptRuntimeConfig = readFileSync('.github/codeql/codeql-backend-receipt-runtime.yml', 'utf8');
  const backendReceiptAiConfig = readFileSync('.github/codeql/codeql-backend-receipt-ai.yml', 'utf8');
  const webCommerceConfig = readFileSync('.github/codeql/codeql-web-commerce.yml', 'utf8');
  const webReceiptsConfig = readFileSync('.github/codeql/codeql-web-receipts.yml', 'utf8');
  const automationConfig = readFileSync('.github/codeql/codeql-automation.yml', 'utf8');

  assert.match(actionsConfig, /\.github\/workflows/u);
  assert.match(backendCatalogConfig, /src\/api\/catalog-management-core\.ts[\s\S]*src\/infrastructure\/catalog-repository\.ts/u);
  assert.match(backendPlatformConfig, /src\/api\/server\.ts[\s\S]*src\/infrastructure\/database\.ts[\s\S]*src\/main\.ts/u);
  assert.match(backendOperationsConfig, /src\/api\/inventory-ticket-management\.ts[\s\S]*src\/operations/u);
  assert.match(backendReceiptRuntimeConfig, /src\/api\/server\.ts[\s\S]*src\/infrastructure\/database\.ts[\s\S]*src\/receipts/u);
  assert.match(backendReceiptAiConfig, /src\/ai[\s\S]*src\/ocr[\s\S]*src\/receipts/u);
  assert.match(webCommerceConfig, /src\/web\/lists\.js[\s\S]*src\/web\/inventory-swipe\.js/u);
  assert.match(webReceiptsConfig, /src\/web\/ticket-history\.js[\s\S]*src\/web\/receipt-review\.js[\s\S]*src\/web\/operations\.js/u);
  assert.match(automationConfig, /paths:\n\s+- scripts\n\s+- playwright\.config\.mjs/u);
});
\\\\t' read -r codeql_run_id codeql_status codeql_conclusion"));
  assert.match(finalJob, /\.category == \$category/u);
  for (const dependency of [
    'quality',
    'integration',
    'security',
    'browser-runtime',
    'browser-e2e',
    'browser-coverage',
    'container',
    'container-smoke',
  ]) {
    assert.match(finalJob, new RegExp('\\n\\s+- ' + dependency + '\\n', 'u'));
  }
});

test('CodeQL keeps full language coverage through one-minute architecture scopes', () => {
  assert.match(codeql, /timeout-minutes:\s*1/u);
  assert.match(codeql, /wait-for-processing:\s*false/u);
  for (const scope of ['actions', 'backend-catalog', 'backend-platform', 'backend-operations', 'backend-receipt-runtime', 'backend-receipt-ai', 'web-commerce', 'web-receipts', 'automation']) {
    assert.match(codeql, new RegExp('scope: ' + scope, 'u'));
  }
  assert.equal((codeql.match(/language: javascript-typescript/gu) || []).length, 8);
  assert.match(codeql, /language: actions/u);
  assert.match(codeql, /config-file:\s+\$\{\{ matrix\.config \}\}/u);
  assert.match(codeql, /category:\s+\/language:\$\{\{ matrix\.language \}\}\/scope:\$\{\{ matrix\.scope \}\}/u);
  assert.doesNotMatch(codeql, /\n\s+tests\n/u);

  const actionsConfig = readFileSync('.github/codeql/codeql-actions.yml', 'utf8');
  const backendCatalogConfig = readFileSync('.github/codeql/codeql-backend-catalog.yml', 'utf8');
  const backendPlatformConfig = readFileSync('.github/codeql/codeql-backend-platform.yml', 'utf8');
  const backendOperationsConfig = readFileSync('.github/codeql/codeql-backend-operations.yml', 'utf8');
  const backendReceiptRuntimeConfig = readFileSync('.github/codeql/codeql-backend-receipt-runtime.yml', 'utf8');
  const backendReceiptAiConfig = readFileSync('.github/codeql/codeql-backend-receipt-ai.yml', 'utf8');
  const webCommerceConfig = readFileSync('.github/codeql/codeql-web-commerce.yml', 'utf8');
  const webReceiptsConfig = readFileSync('.github/codeql/codeql-web-receipts.yml', 'utf8');
  const automationConfig = readFileSync('.github/codeql/codeql-automation.yml', 'utf8');

  assert.match(actionsConfig, /\.github\/workflows/u);
  assert.match(backendCatalogConfig, /src\/api\/catalog-management-core\.ts[\s\S]*src\/infrastructure\/catalog-repository\.ts/u);
  assert.match(backendPlatformConfig, /src\/api\/server\.ts[\s\S]*src\/infrastructure\/database\.ts[\s\S]*src\/main\.ts/u);
  assert.match(backendOperationsConfig, /src\/api\/inventory-ticket-management\.ts[\s\S]*src\/operations/u);
  assert.match(backendReceiptRuntimeConfig, /src\/api\/server\.ts[\s\S]*src\/infrastructure\/database\.ts[\s\S]*src\/receipts/u);
  assert.match(backendReceiptAiConfig, /src\/ai[\s\S]*src\/ocr[\s\S]*src\/receipts/u);
  assert.match(webCommerceConfig, /src\/web\/lists\.js[\s\S]*src\/web\/inventory-swipe\.js/u);
  assert.match(webReceiptsConfig, /src\/web\/ticket-history\.js[\s\S]*src\/web\/receipt-review\.js[\s\S]*src\/web\/operations\.js/u);
  assert.match(automationConfig, /paths:\n\s+- scripts\n\s+- playwright\.config\.mjs/u);
});
