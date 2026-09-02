import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { parseAiRuntimeCapabilities, type WebApiRuntimeCapabilities } from './runtime-capabilities.ts';

const CACHE_DISPLAY_NAME = 'WebAPI runtime capabilities cache';
const CACHE_RESPONSE_HEADER = 'x-basketra-capabilities-cache';

type CapabilityProviderIdentity = Readonly<{
  baseUrl: URL;
  model: string;
}>;

export class AiRuntimeCapabilitiesCacheStore {
  readonly #database: DatabaseSync;

  constructor(databasePath: string) {
    this.#database = new DatabaseSync(databasePath);
    this.#database.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  }

  read(baseUrl: URL, model: string): WebApiRuntimeCapabilities | undefined {
    const row = this.#database.prepare(`
      SELECT base_url AS baseUrl, model, capabilities_json AS capabilitiesJson
      FROM ai_provider_configurations
      WHERE id = ?
    `).get(cacheId(baseUrl, model)) as {
      baseUrl: string;
      model: string;
      capabilitiesJson: string;
    } | undefined;
    if (!row || row.baseUrl !== normalizeBaseUrl(baseUrl) || row.model !== model) return undefined;
    try {
      return parseAiRuntimeCapabilities(JSON.parse(row.capabilitiesJson) as unknown);
    } catch {
      return undefined;
    }
  }

  write(baseUrl: URL, model: string, capabilities: WebApiRuntimeCapabilities): void {
    const validated = parseAiRuntimeCapabilities(capabilities);
    if (!validated) throw new TypeError('WebAPI runtime capabilities are invalid');
    const timestamp = new Date().toISOString();
    const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
    this.#database.prepare(`
      INSERT INTO ai_provider_configurations(
        id, display_name, base_url, model, secret_mask, capabilities_json, enabled, created_at, updated_at
      ) VALUES (?, ?, ?, ?, NULL, ?, 1, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        display_name = excluded.display_name,
        base_url = excluded.base_url,
        model = excluded.model,
        secret_mask = NULL,
        capabilities_json = excluded.capabilities_json,
        enabled = 1,
        updated_at = excluded.updated_at
    `).run(
      cacheId(baseUrl, model),
      CACHE_DISPLAY_NAME,
      normalizedBaseUrl,
      model,
      JSON.stringify(validated),
      timestamp,
      timestamp,
    );
  }

  close(): void {
    this.#database.close();
  }
}

export function installAiRuntimeCapabilitiesCache(input: Readonly<{
  databasePath: string;
  baseUrl?: URL;
  model?: string;
  provider?: () => CapabilityProviderIdentity | undefined;
}>): () => void {
  const store = new AiRuntimeCapabilitiesCacheStore(input.databasePath);
  const delegate = globalThis.fetch;
  const cachedFetch = (async (
    resource: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> => {
    const provider = resolveProviderIdentity(input);
    if (!provider) return await delegate(resource, init);
    const requestUrl = resource instanceof Request ? resource.url : String(resource);
    const capabilitiesUrl = new URL('capabilities', ensureTrailingSlash(provider.baseUrl)).href;
    if (new URL(requestUrl).href !== capabilitiesUrl) return await delegate(resource, init);

    try {
      const response = await delegate(resource, init);
      if (response.ok) {
        const capabilities = await parseResponseCapabilities(response.clone());
        if (capabilities) {
          store.write(provider.baseUrl, provider.model, capabilities);
          return response;
        }
        return cachedCapabilitiesResponse(store.read(provider.baseUrl, provider.model)) ?? response;
      }
      if (response.status === 401 || response.status === 403) return response;
      return cachedCapabilitiesResponse(store.read(provider.baseUrl, provider.model)) ?? response;
    } catch (error) {
      const cached = cachedCapabilitiesResponse(store.read(provider.baseUrl, provider.model));
      if (cached) return cached;
      throw error;
    }
  }) as typeof fetch;

  globalThis.fetch = cachedFetch;
  let closed = false;
  return () => {
    if (closed) return;
    closed = true;
    if (globalThis.fetch === cachedFetch) globalThis.fetch = delegate;
    store.close();
  };
}

function resolveProviderIdentity(input: Readonly<{
  baseUrl?: URL;
  model?: string;
  provider?: () => CapabilityProviderIdentity | undefined;
}>): CapabilityProviderIdentity | undefined {
  if (input.provider) return input.provider();
  if (input.baseUrl && input.model) return { baseUrl: input.baseUrl, model: input.model };
  return undefined;
}

async function parseResponseCapabilities(response: Response): Promise<WebApiRuntimeCapabilities | undefined> {
  try {
    return parseAiRuntimeCapabilities(JSON.parse(await response.text()) as unknown);
  } catch {
    return undefined;
  }
}

function cachedCapabilitiesResponse(capabilities: WebApiRuntimeCapabilities | undefined): Response | undefined {
  if (!capabilities) return undefined;
  return new Response(JSON.stringify(capabilities), {
    status: 200,
    headers: {
      'content-type': 'application/json',
      [CACHE_RESPONSE_HEADER]: 'stale',
    },
  });
}

function cacheId(baseUrl: URL, model: string): string {
  const identity = `${normalizeBaseUrl(baseUrl)}\n${model}`;
  return `runtime-capabilities-${createHash('sha256').update(identity).digest('hex').slice(0, 32)}`;
}

function normalizeBaseUrl(baseUrl: URL): string {
  return ensureTrailingSlash(baseUrl).href;
}

function ensureTrailingSlash(url: URL): URL {
  const copy = new URL(url);
  if (!copy.pathname.endsWith('/')) copy.pathname += '/';
  return copy;
}
