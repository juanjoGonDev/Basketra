import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { validateGhcrWorkflows } from '../../scripts/ghcr-workflow-policy.mjs';

const ci = readFileSync('.github/workflows/ci.yml', 'utf8');
const publication = readFileSync('.github/workflows/publish-ghcr.yml', 'utf8');

test('accepts the separated trusted publication workflow', () => {
  assert.deepEqual(validateGhcrWorkflows(ci, publication), []);
});

test('rejects write permissions in the validation workflow', () => {
  const unsafeCi = `${ci}\npermissions:\n  packages: write\n`;
  assert.ok(validateGhcrWorkflows(unsafeCi, publication).some(value => (
    value.includes('CI workflow: forbidden packages: write')
  )));
});

test('rejects privileged publication from pull requests', () => {
  const unsafePublication = publication.replace(
    '  push:\n    branches:',
    '  pull_request:\n    branches:',
  );
  const failures = validateGhcrWorkflows(ci, unsafePublication);
  assert.ok(failures.includes('GHCR publication workflow: missing top-level push trigger'));
  assert.ok(failures.includes('GHCR publication workflow: forbidden top-level pull_request trigger'));
});

test('rejects the legacy workflow-run publication path', () => {
  const unsafePublication = publication.replace(
    '  push:\n    branches:',
    '  workflow_run:\n    branches:',
  );
  const failures = validateGhcrWorkflows(ci, unsafePublication);
  assert.ok(failures.includes('GHCR publication workflow: missing top-level push trigger'));
  assert.ok(failures.includes('GHCR publication workflow: forbidden top-level workflow_run trigger'));
});

test('rejects candidate publication that bypasses the validated SHA alias', () => {
  const unsafePublication = publication.replace(
    'ghcr.io/juanjogondev/basketra:${{ env.VALIDATED_SHA }}',
    'ghcr.io/juanjogondev/basketra:${{ github.sha }}',
  );
  const failures = validateGhcrWorkflows(ci, unsafePublication);
  assert.ok(failures.some(value => (
    value.includes('missing ghcr.io/juanjogondev/basketra:${{ env.VALIDATED_SHA }}')
  )));
});

test('rejects checkout that is not pinned to the validated SHA', () => {
  const unsafePublication = publication.replace(
    'ref: ${{ env.VALIDATED_SHA }}',
    'ref: ${{ github.ref }}',
  );
  assert.ok(validateGhcrWorkflows(ci, unsafePublication).some(value => (
    value.includes('missing ref: ${{ env.VALIDATED_SHA }}')
  )));
});
