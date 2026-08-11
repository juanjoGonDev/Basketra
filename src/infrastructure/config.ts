import { resolve } from 'node:path';

export type AppConfig = Readonly<{
  host: string;
  port: number;
  dataDir: string;
  tempDir: string;
  maxBodyBytes: number;
  aiBaseUrl?: string;
  aiApiKey?: string;
  aiModel?: string;
  aiMaxRetries: number;
  aiImageCapability: boolean;
  aiPdfCapability: boolean;
  overpassBaseUrl: string;
  idleHibernateAfterMs: number;
  idleExitAfterMs: number;
}>;

function readInteger(environment: NodeJS.ProcessEnv, key: string, fallback: number, minimum: number): number {
  const raw = environment[key];
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < minimum) throw new Error(`${key} must be an integer >= ${minimum}`);
  return parsed;
}

function readBoolean(environment: NodeJS.ProcessEnv, key: string, fallback: boolean): boolean {
  const raw = environment[key]?.trim().toLowerCase();
  if (raw === undefined || raw === '') return fallback;
  if (raw === 'true' || raw === '1') return true;
  if (raw === 'false' || raw === '0') return false;
  throw new Error(`${key} must be true, false, 1 or 0`);
}

export function loadConfig(environment: NodeJS.ProcessEnv = process.env): AppConfig {
  const host = environment['BASKETRA_HOST']?.trim() || '127.0.0.1';
  const aiBaseUrl = environment['BASKETRA_AI_BASE_URL']?.trim() || undefined;
  if (aiBaseUrl) validateProviderBaseUrl(aiBaseUrl);
  const overpassBaseUrl = environment['BASKETRA_OVERPASS_BASE_URL']?.trim() || 'https://overpass-api.de/api/';
  validateOverpassBaseUrl(overpassBaseUrl);
  return {
    host,
    port: readInteger(environment, 'BASKETRA_PORT', 3000, 1),
    dataDir: resolve(environment['BASKETRA_DATA_DIR']?.trim() || './data'),
    tempDir: resolve(environment['BASKETRA_TEMP_DIR']?.trim() || './tmp'),
    maxBodyBytes: readInteger(environment, 'BASKETRA_MAX_BODY_BYTES', 32 * 1024 * 1024, 1024),
    ...(aiBaseUrl ? { aiBaseUrl } : {}),
    ...(environment['BASKETRA_AI_API_KEY']?.trim() ? { aiApiKey: environment['BASKETRA_AI_API_KEY']!.trim() } : {}),
    ...(environment['BASKETRA_AI_MODEL']?.trim() ? { aiModel: environment['BASKETRA_AI_MODEL']!.trim() } : {}),
    aiMaxRetries: readInteger(environment, 'BASKETRA_AI_MAX_RETRIES', 1, 0),
    aiImageCapability: readBoolean(environment, 'BASKETRA_AI_IMAGE_CAPABILITY', true),
    aiPdfCapability: readBoolean(environment, 'BASKETRA_AI_PDF_CAPABILITY', false),
    overpassBaseUrl,
    idleHibernateAfterMs: readInteger(environment, 'BASKETRA_IDLE_HIBERNATE_AFTER_MS', 300_000, 0),
    idleExitAfterMs: readInteger(environment, 'IDLE_EXIT_AFTER_MS', 0, 0),
  };
}

export function validateProviderBaseUrl(input: string): URL {
  return validateHttpBaseUrl(input, 'AI provider');
}

export function validateOverpassBaseUrl(input: string): URL {
  return validateHttpBaseUrl(input, 'Overpass');
}

function validateHttpBaseUrl(input: string, label: string): URL {
  const url = new URL(input);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error(`${label} URL must use HTTP or HTTPS`);
  if (url.username || url.password) throw new Error(`${label} URL must not include credentials`);
  if (url.hash || url.search) throw new Error(`${label} URL must not include query or fragment`);
  return url;
}
