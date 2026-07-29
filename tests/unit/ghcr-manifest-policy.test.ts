import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertCandidateManifest,
  assertStableManifest,
  runnablePlatforms,
} from '../../scripts/ghcr-manifest-policy.mjs';

const digest = `sha256:${'a'.repeat(64)}`;
const otherDigest = `sha256:${'b'.repeat(64)}`;

function manifest(platforms: Array<{ os: string; architecture: string }>, value = digest) {
  return {
    digest: value,
    manifests: platforms.map((platform) => ({ platform })),
  };
}

const runnable = [
  { os: 'linux', architecture: 'amd64' },
  { os: 'unknown', architecture: 'unknown' },
  { os: 'linux', architecture: 'arm64' },
];

test('candidate manifest accepts the exact digest and both runnable platforms while ignoring attestations', () => {
  const candidate = manifest(runnable);
  assert.deepEqual(runnablePlatforms(candidate), ['linux/amd64', 'linux/arm64']);
  assert.doesNotThrow(() => assertCandidateManifest(candidate, digest));
});

test('candidate manifest rejects digest and platform drift', () => {
  assert.throws(() => assertCandidateManifest(manifest(runnable, otherDigest), digest), /Candidate digest mismatch/);
  assert.throws(
    () => assertCandidateManifest(manifest([{ os: 'linux', architecture: 'amd64' }]), digest),
    /Unexpected runnable platforms/,
  );
});

test('stable promotion must resolve to the validated candidate digest', () => {
  const candidate = manifest(runnable);
  assert.doesNotThrow(() => assertStableManifest(candidate, manifest(runnable), digest));
  assert.throws(() => assertStableManifest(candidate, manifest(runnable, otherDigest), digest), /Stable digest mismatch/);
});
