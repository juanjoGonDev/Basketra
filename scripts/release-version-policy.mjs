const STABLE_TAG = /^v?(\d+)\.(\d+)\.(\d+)$/;

export function parseStableVersion(tag) {
  const match = STABLE_TAG.exec(String(tag || '').trim());
  if (!match) return undefined;
  const values = match.slice(1).map(Number);
  if (!values.every(Number.isSafeInteger)) return undefined;
  const [major, minor, patch] = values;
  return { major, minor, patch, version: `${major}.${minor}.${patch}`, tag: `v${major}.${minor}.${patch}` };
}

function compareVersions(left, right) {
  return left.major - right.major || left.minor - right.minor || left.patch - right.patch;
}

export function resolveReleaseVersion(releases, currentSha) {
  const stable = releases
    .filter((release) => release && release.draft !== true && release.prerelease !== true)
    .map((release) => ({ release, parsed: parseStableVersion(release.tag_name) }))
    .filter((entry) => entry.parsed);

  const existing = stable.find((entry) => entry.release.target_commitish === currentSha);
  if (existing) {
    return { ...existing.parsed, reused: true };
  }

  const latest = stable.map((entry) => entry.parsed).sort(compareVersions).at(-1);
  if (!latest) return { major: 1, minor: 0, patch: 0, version: '1.0.0', tag: 'v1.0.0', reused: false };
  if (latest.patch === Number.MAX_SAFE_INTEGER) throw new Error('Release patch component exhausted safe integer range');
  const patch = latest.patch + 1;
  return {
    major: latest.major,
    minor: latest.minor,
    patch,
    version: `${latest.major}.${latest.minor}.${patch}`,
    tag: `v${latest.major}.${latest.minor}.${patch}`,
    reused: false,
  };
}
