import { DatabaseSync } from 'node:sqlite';
import { validateOverpassBaseUrl, validateProviderBaseUrl } from './config.ts';

export const DEFAULT_RUNTIME_SETTINGS = Object.freeze({
  aiMaxRetries: 1,
  overpassBaseUrl: 'https://overpass-api.de/api/',
  maxBodyBytes: 32 * 1024 * 1024,
  idleHibernateAfterMs: 300_000,
});

export const RUNTIME_BODY_BYTES_MIN = 1024;
export const RUNTIME_BODY_BYTES_MAX = 512 * 1024 * 1024;
export const RUNTIME_IDLE_HIBERNATE_MAX_MS = 24 * 60 * 60 * 1000;
export const RUNTIME_AI_MAX_RETRIES = 10;

export type RuntimeSettings = Readonly<{
  aiBaseUrl?: string;
  aiApiKey?: string;
  aiModel?: string;
  aiMaxRetries: number;
  overpassBaseUrl: string;
  maxBodyBytes: number;
  idleHibernateAfterMs: number;
  updatedAt: string;
}>;

export type PublicRuntimeSettings = Readonly<{
  ai: Readonly<{
    configured: boolean;
    baseUrl: string | null;
    model: string | null;
    maxRetries: number;
    apiKeyConfigured: boolean;
    apiKeyMask: string | null;
  }>;
  overpassBaseUrl: string;
  maxBodyBytes: number;
  idleHibernateAfterMs: number;
  updatedAt: string;
}>;

export type RuntimeSettingsUpdate = Readonly<{
  aiBaseUrl?: string | null;
  aiApiKey?: string | null;
  aiModel?: string | null;
  aiMaxRetries?: number;
  overpassBaseUrl?: string;
  maxBodyBytes?: number;
  idleHibernateAfterMs?: number;
}>;

type RuntimeSettingsRow = Readonly<{
  aiBaseUrl: string | null;
  aiApiKey: string | null;
  aiModel: string | null;
  aiMaxRetries: number;
  overpassBaseUrl: string;
  maxBodyBytes: number;
  idleHibernateAfterMs: number;
  updatedAt: string;
}>;

export class RuntimeSettingsStore {
  readonly #database: DatabaseSync;

  constructor(databasePath: string) {
    this.#database = new DatabaseSync(databasePath);
    this.#database.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  }

  read(): RuntimeSettings {
    const row = this.#database.prepare(`
      SELECT
        ai_base_url AS aiBaseUrl,
        ai_api_key AS aiApiKey,
        ai_model AS aiModel,
        ai_max_retries AS aiMaxRetries,
        overpass_base_url AS overpassBaseUrl,
        max_body_bytes AS maxBodyBytes,
        idle_hibernate_after_ms AS idleHibernateAfterMs,
        updated_at AS updatedAt
      FROM runtime_settings
      WHERE id = 'instance'
    `).get() as RuntimeSettingsRow | undefined;
    if (!row) throw new Error('Runtime settings row is missing');
    return runtimeSettingsFromRow(row);
  }

  update(value: unknown): RuntimeSettings {
    const patch = parseRuntimeSettingsUpdate(value);
    const current = this.read();
    const next = mergeRuntimeSettings(current, patch);
    const updatedAt = new Date().toISOString();
    this.#database.prepare(`
      UPDATE runtime_settings
      SET
        ai_base_url = ?,
        ai_api_key = ?,
        ai_model = ?,
        ai_max_retries = ?,
        overpass_base_url = ?,
        max_body_bytes = ?,
        idle_hibernate_after_ms = ?,
        updated_at = ?
      WHERE id = 'instance'
    `).run(
      next.aiBaseUrl ?? null,
      next.aiApiKey ?? null,
      next.aiModel ?? null,
      next.aiMaxRetries,
      next.overpassBaseUrl,
      next.maxBodyBytes,
      next.idleHibernateAfterMs,
      updatedAt,
    );
    return { ...next, updatedAt };
  }

  close(): void {
    this.#database.close();
  }
}

export function toPublicRuntimeSettings(settings: RuntimeSettings): PublicRuntimeSettings {
  return {
    ai: {
      configured: Boolean(settings.aiBaseUrl && settings.aiModel),
      baseUrl: settings.aiBaseUrl ?? null,
      model: settings.aiModel ?? null,
      maxRetries: settings.aiMaxRetries,
      apiKeyConfigured: settings.aiApiKey !== undefined,
      apiKeyMask: settings.aiApiKey ? maskSecret(settings.aiApiKey) : null,
    },
    overpassBaseUrl: settings.overpassBaseUrl,
    maxBodyBytes: settings.maxBodyBytes,
    idleHibernateAfterMs: settings.idleHibernateAfterMs,
    updatedAt: settings.updatedAt,
  };
}

export function parseRuntimeSettingsUpdate(value: unknown): RuntimeSettingsUpdate {
  if (!isRecord(value)) throw new TypeError('Runtime settings update must be an object');
  const allowed = new Set([
    'aiBaseUrl',
    'aiApiKey',
    'aiModel',
    'aiMaxRetries',
    'overpassBaseUrl',
    'maxBodyBytes',
    'idleHibernateAfterMs',
  ]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new TypeError(`Unknown runtime setting: ${key}`);
  }

  const patch: {
    aiBaseUrl?: string | null;
    aiApiKey?: string | null;
    aiModel?: string | null;
    aiMaxRetries?: number;
    overpassBaseUrl?: string;
    maxBodyBytes?: number;
    idleHibernateAfterMs?: number;
  } = {};
  if (Object.hasOwn(value, 'aiBaseUrl')) patch.aiBaseUrl = optionalUrl(value['aiBaseUrl'], 'AI provider');
  if (Object.hasOwn(value, 'aiApiKey')) patch.aiApiKey = optionalSecret(value['aiApiKey']);
  if (Object.hasOwn(value, 'aiModel')) patch.aiModel = optionalText(value['aiModel'], 'AI model', 240);
  if (Object.hasOwn(value, 'aiMaxRetries')) {
    patch.aiMaxRetries = boundedInteger(value['aiMaxRetries'], 'AI max retries', 0, RUNTIME_AI_MAX_RETRIES);
  }
  if (Object.hasOwn(value, 'overpassBaseUrl')) {
    const overpassBaseUrl = requiredText(value['overpassBaseUrl'], 'Overpass URL', 2048);
    validateOverpassBaseUrl(overpassBaseUrl);
    patch.overpassBaseUrl = overpassBaseUrl;
  }
  if (Object.hasOwn(value, 'maxBodyBytes')) {
    patch.maxBodyBytes = boundedInteger(
      value['maxBodyBytes'],
      'Local request limit',
      RUNTIME_BODY_BYTES_MIN,
      RUNTIME_BODY_BYTES_MAX,
    );
  }
  if (Object.hasOwn(value, 'idleHibernateAfterMs')) {
    patch.idleHibernateAfterMs = boundedInteger(
      value['idleHibernateAfterMs'],
      'Idle hibernation delay',
      0,
      RUNTIME_IDLE_HIBERNATE_MAX_MS,
    );
  }
  return patch;
}

function runtimeSettingsFromRow(row: RuntimeSettingsRow): RuntimeSettings {
  if (row.aiBaseUrl) validateProviderBaseUrl(row.aiBaseUrl);
  validateOverpassBaseUrl(row.overpassBaseUrl);
  return {
    ...(row.aiBaseUrl ? { aiBaseUrl: row.aiBaseUrl } : {}),
    ...(row.aiApiKey ? { aiApiKey: row.aiApiKey } : {}),
    ...(row.aiModel ? { aiModel: row.aiModel } : {}),
    aiMaxRetries: boundedInteger(row.aiMaxRetries, 'AI max retries', 0, RUNTIME_AI_MAX_RETRIES),
    overpassBaseUrl: row.overpassBaseUrl,
    maxBodyBytes: boundedInteger(
      row.maxBodyBytes,
      'Local request limit',
      RUNTIME_BODY_BYTES_MIN,
      RUNTIME_BODY_BYTES_MAX,
    ),
    idleHibernateAfterMs: boundedInteger(
      row.idleHibernateAfterMs,
      'Idle hibernation delay',
      0,
      RUNTIME_IDLE_HIBERNATE_MAX_MS,
    ),
    updatedAt: row.updatedAt,
  };
}

function mergeRuntimeSettings(
  current: RuntimeSettings,
  patch: RuntimeSettingsUpdate,
): RuntimeSettings {
  const aiBaseUrl = Object.hasOwn(patch, 'aiBaseUrl') ? patch.aiBaseUrl ?? undefined : current.aiBaseUrl;
  const aiApiKey = Object.hasOwn(patch, 'aiApiKey') ? patch.aiApiKey ?? undefined : current.aiApiKey;
  const aiModel = Object.hasOwn(patch, 'aiModel') ? patch.aiModel ?? undefined : current.aiModel;
  return {
    ...(aiBaseUrl ? { aiBaseUrl } : {}),
    ...(aiApiKey ? { aiApiKey } : {}),
    ...(aiModel ? { aiModel } : {}),
    aiMaxRetries: patch.aiMaxRetries ?? current.aiMaxRetries,
    overpassBaseUrl: patch.overpassBaseUrl ?? current.overpassBaseUrl,
    maxBodyBytes: patch.maxBodyBytes ?? current.maxBodyBytes,
    idleHibernateAfterMs: patch.idleHibernateAfterMs ?? current.idleHibernateAfterMs,
    updatedAt: current.updatedAt,
  };
}

function optionalUrl(value: unknown, label: string): string | null {
  const text = optionalText(value, `${label} URL`, 2048);
  if (text === null) return null;
  validateProviderBaseUrl(text);
  return text;
}

function optionalSecret(value: unknown): string | null {
  if (value === null) return null;
  return requiredText(value, 'AI API token', 8192);
}

function optionalText(value: unknown, label: string, maxLength: number): string | null {
  if (value === null) return null;
  return requiredText(value, label, maxLength);
}

function requiredText(value: unknown, label: string, maxLength: number): string {
  if (typeof value !== 'string') throw new TypeError(`${label} must be a string`);
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > maxLength) {
    throw new RangeError(`${label} must contain between 1 and ${maxLength.toString()} characters`);
  }
  return normalized;
}

function boundedInteger(value: unknown, label: string, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw new RangeError(
      `${label} must be an integer between ${minimum.toString()} and ${maximum.toString()}`,
    );
  }
  return value as number;
}

function maskSecret(secret: string): string {
  const suffix = secret.length > 4 ? secret.slice(-4) : '';
  return `••••${suffix}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
