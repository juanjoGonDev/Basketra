const SEMANTIC_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const REVISION = /^[a-f0-9]{7,64}$/i;

export type RuntimeVersion = Readonly<{
  version: string;
  revision?: string;
}>;

export function resolveRuntimeVersion(environment: NodeJS.ProcessEnv = process.env): RuntimeVersion {
  const configuredVersion = environment['BASKETRA_VERSION']?.trim();
  const version = configuredVersion && SEMANTIC_VERSION.test(configuredVersion)
    ? configuredVersion
    : '0.0.0-dev';
  const configuredRevision = environment['BASKETRA_REVISION']?.trim();
  return {
    version,
    ...(configuredRevision && REVISION.test(configuredRevision)
      ? { revision: configuredRevision }
      : {}),
  };
}

export function nextPatchVersion(latestVersion: string | undefined): string {
  if (!latestVersion) return '1.0.0';
  const normalized = latestVersion.startsWith('v') ? latestVersion.slice(1) : latestVersion;
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(normalized);
  if (!match?.[1] || !match[2] || !match[3]) {
    throw new Error('Latest release version is not a stable semantic version');
  }
  const major = Number(match[1]);
  const minor = Number(match[2]);
  const patch = Number(match[3]);
  if (![major, minor, patch].every(Number.isSafeInteger)) {
    throw new Error('Latest release version is outside safe integer limits');
  }
  return `${major}.${minor}.${patch + 1}`;
}
