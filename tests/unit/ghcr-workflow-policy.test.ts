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

test('rejects publication from pull-request workflow runs', () => {
  const unsafePublication = publication.replace(
    "github.event.workflow_run.event == 'push'",
    "github.event.workflow_run.event == 'pull_request'",
  );
  assert.ok(validateGhcrWorkflows(ci, unsafePublication).some(value => (
    value.includes("missing github.event.workflow_run.event == 'push'")
  )));
});

test('rejects a publication workflow without the same-repository guard', () => {
  const unsafePublication = publication.replace(
    'github.event.workflow_run.head_repository.full_name == github.repository',
    'true',
  );
  assert.ok(validateGhcrWorkflows(ci, unsafePublication).some(value => (
    value.includes('missing github.event.workflow_run.head_repository.full_name == github.repository')
  )));
});

test('rejects publisher-context revisions instead of the validated CI head', () => {
  const unsafePublication = publication.replace(
    'ghcr.io/juanjogondev/basketra:${{ env.VALIDATED_SHA }}',
    'ghcr.io/juanjogondev/basketra:${{ github.sha }}',
  );
  const failures = validateGhcrWorkflows(ci, unsafePublication);
  assert.ok(failures.some(value => value.includes('forbidden ${{ github.sha }}')));
  assert.ok(failures.some(value => value.includes('missing ghcr.io/juanjogondev/basketra:${{ env.VALIDATED_SHA }}')));
});
