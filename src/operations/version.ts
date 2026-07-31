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
