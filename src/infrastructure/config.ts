import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

export type AppConfig = Readonly<{
  host: string;
  port: number;
  dataDir: string;
  tempDir: string;
}>;

const CONTAINER_BOOTSTRAP = Object.freeze({
  host: '0.0.0.0',
  port: 3000,
  dataDir: '/data',
  tempDir: '/tmp/basketra',
});

const LOCAL_BOOTSTRAP = Object.freeze({
  host: '127.0.0.1',
  port: 3000,
  dataDir: './data',
  tempDir: './tmp',
});

export function loadConfig(): AppConfig {
  const defaults = existsSync('/.dockerenv') ? CONTAINER_BOOTSTRAP : LOCAL_BOOTSTRAP;
  return {
    host: defaults.host,
    port: defaults.port,
    dataDir: resolve(defaults.dataDir),
    tempDir: resolve(defaults.tempDir),
  };
}

export function validateProviderBaseUrl(input: string): URL {
  return validateHttpBaseUrl(input, 'AI provider');
}

export function validateOverpassBaseUrl(input: string): URL {
  return validateHttpBaseUrl(input, 'Overpass');
}

function validateHttpBaseUrl(input: string, label: string): URL {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new RangeError(`${label} URL must be an absolute HTTP or HTTPS URL`);
  }
  if (!['http:', 'https:'].includes(url.protocol)) throw new RangeError(`${label} URL must use HTTP or HTTPS`);
  if (url.username || url.password) throw new RangeError(`${label} URL must not include credentials`);
  if (url.hash || url.search) throw new RangeError(`${label} URL must not include query or fragment`);
  return url;
}
