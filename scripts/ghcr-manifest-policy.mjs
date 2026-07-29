import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const EXPECTED_RUNNABLE_PLATFORMS = Object.freeze(['linux/amd64', 'linux/arm64']);

function assertDigest(value, label) {
  if (typeof value !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(value)) {
    throw new Error(`${label} must be a sha256 digest`);
  }
}

function assertManifestObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be a manifest object`);
  }
}

export function runnablePlatforms(manifest) {
  assertManifestObject(manifest, 'Manifest');
  if (!Array.isArray(manifest.manifests)) throw new Error('Manifest must contain a manifests array');

  return [...new Set(
    manifest.manifests
      .map((entry) => entry?.platform)
      .filter((platform) =>
        platform?.os &&
        platform?.architecture &&
        platform.os !== 'unknown' &&
        platform.architecture !== 'unknown',
      )
      .map((platform) => `${platform.os}/${platform.architecture}`),
  )].sort();
}

export function assertCandidateManifest(manifest, expectedDigest) {
  assertManifestObject(manifest, 'Candidate manifest');
  assertDigest(expectedDigest, 'Expected digest');
  assertDigest(manifest.digest, 'Candidate manifest digest');

  if (manifest.digest !== expectedDigest) {
    throw new Error(`Candidate digest mismatch: expected ${expectedDigest}, received ${manifest.digest}`);
  }

  const platforms = runnablePlatforms(manifest);
  if (JSON.stringify(platforms) !== JSON.stringify(EXPECTED_RUNNABLE_PLATFORMS)) {
    throw new Error(`Unexpected runnable platforms: ${JSON.stringify(platforms)}`);
  }
}

export function assertStableManifest(candidateManifest, stableManifest, expectedDigest) {
  assertCandidateManifest(candidateManifest, expectedDigest);
  assertManifestObject(stableManifest, 'Stable manifest');
  assertDigest(stableManifest.digest, 'Stable manifest digest');

  if (stableManifest.digest !== expectedDigest) {
    throw new Error(`Stable digest mismatch: expected ${expectedDigest}, received ${stableManifest.digest}`);
  }
}

function readManifest(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function runCli(argv) {
  const [mode, ...args] = argv;
  if (mode === 'candidate' && args.length === 2) {
    assertCandidateManifest(readManifest(args[0]), args[1]);
    return;
  }
  if (mode === 'stable' && args.length === 3) {
    assertStableManifest(readManifest(args[0]), readManifest(args[1]), args[2]);
    return;
  }
  throw new Error('Usage: ghcr-manifest-policy.mjs candidate <manifest.json> <digest> | stable <candidate.json> <stable.json> <digest>');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) runCli(process.argv.slice(2));
