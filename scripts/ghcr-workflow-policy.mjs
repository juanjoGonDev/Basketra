function requireText(text, requiredValues, prefix, failures) {
  for (const required of requiredValues) {
    if (!text.includes(required)) failures.push(`${prefix}: missing ${required}`);
  }
}

function forbidText(text, forbiddenValues, prefix, failures) {
  for (const forbidden of forbiddenValues) {
    if (text.includes(forbidden)) failures.push(`${prefix}: forbidden ${forbidden}`);
  }
}

export function validateGhcrWorkflows(ci, publication) {
  const failures = [];

  requireText(ci, [
    'pull_request:',
    '- main',
    'permissions: read-all',
    'browser-e2e:',
    'container-smoke:',
  ], 'CI workflow', failures);
  forbidText(ci, [
    '\n  push:',
    'publish-image:',
    'packages: write',
    'contents: write',
    'docker/login-action@',
    'Publish immutable SHA candidate',
  ], 'CI workflow', failures);

  requireText(publication, [
    'push:',
    '- main',
    'permissions: read-all',
    'publish-image:',
    'contents: write',
    'packages: write',
    'VALIDATED_SHA: ${{ github.sha }}',
    'ref: ${{ env.VALIDATED_SHA }}',
    'test "$(git rev-parse HEAD)" = "$VALIDATED_SHA"',
    'linux/amd64,linux/arm64',
    'Resolve deterministic patch release',
    'release-version-policy.mjs',
    'resolveReleaseVersion(releases, process.env.VALIDATED_SHA)',
    'id: publish-sha',
    'ghcr.io/juanjogondev/basketra:${{ env.VALIDATED_SHA }}',
    'BASKETRA_VERSION=${{ steps.release-version.outputs.version }}',
    'BASKETRA_REVISION=${{ env.VALIDATED_SHA }}',
    'steps.publish-sha.outputs.digest',
    "imagetools inspect --format '{{json .Manifest}}' \"$IMAGE:$VALIDATED_SHA\"",
    'node scripts/ghcr-manifest-policy.mjs candidate',
    'docker pull --platform linux/amd64 "$IMAGE:$VALIDATED_SHA"',
    'org.opencontainers.image.revision=${{ env.VALIDATED_SHA }}',
    'org.opencontainers.image.version',
    'http://127.0.0.1:3001/readiness',
    'http://127.0.0.1:3001/api/v1/runtime',
    'process.env.VALIDATED_SHA',
    'id: promote',
    'imagetools create --metadata-file stable-promotion.json --tag "$IMAGE:stable"',
    'Promote verified digest to immutable version',
    'Create or verify GitHub release',
    'target_commitish: process.env.VALIDATED_SHA',
    'generate_release_notes: true',
    'node scripts/ghcr-manifest-policy.mjs stable',
    'selectGhcrVersionsForDeletion',
    'GHCR_RETAIN_SHA_VERSIONS',
    'Delete an unpromoted failed candidate',
    '--memory-swap 192m',
    'NODE_OPTIONS=--max-old-space-size=128',
  ], 'GHCR publication workflow', failures);
  forbidText(publication, [
    'pull_request:',
    'workflow_run:',
    'github.event.workflow_run',
    'context.sha',
    '$GITHUB_SHA',
    'pull_request_target',
    'workflow_dispatch',
    'CR_PAT',
    'PERSONAL_ACCESS_TOKEN',
    'GHCR_PAT',
    'BASKETRA_AUTH_TOKEN',
  ], 'GHCR publication workflow', failures);

  const publishJobIndex = publication.indexOf('  publish-image:');
  const contentsWriteMatches = [...publication.matchAll(/^\s+contents: write$/gm)];
  const packagesWriteMatches = [...publication.matchAll(/^\s+packages: write$/gm)];
  if (
    publishJobIndex < 0 ||
    contentsWriteMatches.length !== 1 ||
    packagesWriteMatches.length !== 1 ||
    (contentsWriteMatches[0]?.index ?? -1) < publishJobIndex ||
    (packagesWriteMatches[0]?.index ?? -1) < publishJobIndex
  ) {
    failures.push('Write permissions must exist only inside the trusted GHCR publication job');
  }

  const publishIndex = publication.indexOf('- name: Publish immutable SHA candidate');
  const verifyCandidateIndex = publication.indexOf('- name: Verify published SHA tag and manifest');
  const smokeIndex = publication.indexOf('- name: Pull and smoke-test the exact published digest');
  const promoteIndex = publication.indexOf('- name: Promote verified digest to stable');
  const verifyStableIndex = publication.indexOf('- name: Verify stable is the validated manifest');
  const promoteVersionIndex = publication.indexOf('- name: Promote verified digest to immutable version');
  const releaseIndex = publication.indexOf('- name: Create or verify GitHub release');
  if (!(
    publishIndex >= 0 &&
    publishIndex < verifyCandidateIndex &&
    verifyCandidateIndex < smokeIndex &&
    smokeIndex < promoteIndex &&
    promoteIndex < verifyStableIndex &&
    verifyStableIndex < promoteVersionIndex &&
    promoteVersionIndex < releaseIndex
  )) {
    failures.push('GHCR candidate, digest verification, smoke, promotion and release steps are out of order');
  }

  const candidateSection = publication.slice(publishIndex, verifyCandidateIndex);
  if (candidateSection.includes('basketra:stable')) {
    failures.push('The immutable candidate build must not publish stable before verification');
  }

  return failures;
}
