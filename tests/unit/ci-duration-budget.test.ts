import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const ci = readFileSync('.github/workflows/ci.yml', 'utf8');
const codeql = readFileSync('.github/workflows/codeql.yml', 'utf8');

test('every pull-request CI job has a hard one-minute envelope', () => {
  const timeoutValues = [...ci.matchAll(/timeout-minutes:\s*(\d+)/gu)].map(match => Number(match[1]));
  assert.ok(timeoutValues.length >= 7);
  assert.deepEqual(new Set(timeoutValues), new Set([1]));
  assert.match(ci, /browser-e2e:\n[\s\S]*?timeout-minutes:\s*1/u);
  assert.match(ci, /timeout --signal=TERM --kill-after=5s 45s pnpm exec playwright test --test-list=/u);
});

test('CodeQL keeps full language coverage through one-minute architecture scopes', () => {
  assert.match(codeql, /timeout-minutes:\s*1/u);
  for (const scope of ['actions', 'backend-http-data', 'backend-receipt-runtime', 'backend-receipt-ai', 'backend-services', 'web', 'automation']) {
    assert.match(codeql, new RegExp('scope: ' + scope, 'u'));
  }
  assert.equal((codeql.match(/language: javascript-typescript/gu) || []).length, 6);
  assert.match(codeql, /language: actions/u);
  assert.match(codeql, /config-file:\s+\$\{\{ matrix\.config \}\}/u);
  assert.match(codeql, /category:\s+\/language:\$\{\{ matrix\.language \}\}\/scope:\$\{\{ matrix\.scope \}\}/u);
  assert.doesNotMatch(codeql, /\n\s+tests\n/u);

  const actionsConfig = readFileSync('.github/codeql/codeql-actions.yml', 'utf8');
  const backendHttpDataConfig = readFileSync('.github/codeql/codeql-backend-http-data.yml', 'utf8');
  const backendReceiptRuntimeConfig = readFileSync('.github/codeql/codeql-backend-receipt-runtime.yml', 'utf8');
  const backendReceiptAiConfig = readFileSync('.github/codeql/codeql-backend-receipt-ai.yml', 'utf8');
  const backendServicesConfig = readFileSync('.github/codeql/codeql-backend-services.yml', 'utf8');
  const webConfig = readFileSync('.github/codeql/codeql-web.yml', 'utf8');
  const automationConfig = readFileSync('.github/codeql/codeql-automation.yml', 'utf8');

  assert.match(actionsConfig, /\.github\/workflows/u);
  assert.match(backendHttpDataConfig, /src\/api[\s\S]*src\/infrastructure/u);
  assert.match(backendReceiptRuntimeConfig, /src\/api\/server\.ts[\s\S]*src\/infrastructure\/database\.ts[\s\S]*src\/receipts/u);
  assert.match(backendReceiptAiConfig, /src\/ai[\s\S]*src\/ocr[\s\S]*src\/receipts/u);
  assert.match(backendServicesConfig, /src\/operations[\s\S]*src\/stores/u);
  assert.match(webConfig, /paths:\n\s+- src\/web/u);
  assert.match(automationConfig, /paths:\n\s+- scripts\n\s+- playwright\.config\.mjs/u);
});
