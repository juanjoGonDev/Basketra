import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const workflow = readFileSync('.github/workflows/ci.yml', 'utf8');

test('browser E2E setup avoids the flaky Azure Ubuntu mirror and is time-bounded', () => {
  const installStep = workflow.match(
    /- name: Install exact browser test tooling[\s\S]*?(?=\n      - name: Run mobile Chromium flows)/u,
  )?.[0];

  assert.ok(installStep, 'browser tooling step must exist');
  assert.match(installStep, /timeout-minutes:\s*8/u);
  assert.match(installStep, /\/etc\/apt\/apt-mirrors\.txt/u);
  assert.match(installStep, /http:\/\/azure\.archive\.ubuntu\.com\/ubuntu/u);
  assert.match(installStep, /https:\/\/archive\.ubuntu\.com\/ubuntu/u);
  assert.match(installStep, /npx playwright install --with-deps chromium/u);
});
