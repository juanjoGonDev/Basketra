import { assertGeoPoint, type GeoPointMicrodegrees } from '../domain/location.ts';

export type NearbyStoreCandidate = Readonly<{
  osmType: 'node' | 'way' | 'relation';
  osmId: string;
  name: string;
  latitudeMicrodegrees: number;
  longitudeMicrodegrees: number;
  address?: string;
}>;

export type NearbyStoreLookup = GeoPointMicrodegrees & Readonly<{
  radiusMeters: number;
  limit: number;
  signal?: AbortSignal;
}>;

const MAX_OVERPASS_RESPONSE_BYTES = 256 * 1024;
const OSM_TYPES = new Set(['node', 'way', 'relation']);

export class OverpassClient {
  readonly #baseUrl: URL;
  readonly #fetchImplementation: typeof fetch;

  constructor(baseUrl: URL, fetchImplementation: typeof fetch = fetch) {
    if (!['http:', 'https:'].includes(baseUrl.protocol) || baseUrl.username || baseUrl.password || baseUrl.search || baseUrl.hash) {
      throw new RangeError('Overpass base URL must be a credential-free HTTP or HTTPS URL without query or fragment');
    }
    this.#baseUrl = new URL(baseUrl.href);
    this.#fetchImplementation = fetchImplementation;
  }

  async findNearbyStores(input: NearbyStoreLookup): Promise<NearbyStoreCandidate[]> {
    assertGeoPoint(input);
    if (!Number.isSafeInteger(input.radiusMeters) || input.radiusMeters < 100 || input.radiusMeters > 5_000) {
      throw new RangeError('Nearby-store radius must be between 100 and 5000 meters');
    }
    if (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 20) {
      throw new RangeError('Nearby-store limit must be between 1 and 20');
    }
    input.signal?.throwIfAborted();

    const latitude = input.latitudeMicrodegrees / 1_000_000;
    const longitude = input.longitudeMicrodegrees / 1_000_000;
    const query = [
      '[out:json][timeout:12];',
      '(',
      `nwr["shop"~"^(supermarket|convenience|grocery)$"](around:${input.radiusMeters},${latitude},${longitude});`,
      ');',
      `out center tags ${input.limit};`,
    ].join('');
    let response: Response;
    try {
      response = await this.#fetchImplementation(new URL('interpreter', ensureTrailingSlash(this.#baseUrl)), {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded; charset=utf-8',
          'user-agent': 'Basketra/1 nearby-store lookup',
        },
        body: new URLSearchParams({ data: query }),
        ...(input.signal ? { signal: input.signal } : {}),
      });
    } catch (error) {
      input.signal?.throwIfAborted();
      throw new Error('OVERPASS_UNAVAILABLE', { cause: error });
    }
    if (!response.ok) throw new Error('OVERPASS_UNAVAILABLE');
    const body = await readBoundedJson(response, MAX_OVERPASS_RESPONSE_BYTES);
    return parseCandidates(body, input.limit);
  }
}

async function readBoundedJson(response: Response, maximumBytes: number): Promise<unknown> {
  const declared = response.headers.get('content-length');
  if (declared !== null) {
    const bytes = Number(declared);
    if (Number.isFinite(bytes) && bytes > maximumBytes) throw new Error('OVERPASS_RESPONSE_TOO_LARGE');
  }
  if (!response.body) throw new Error('OVERPASS_INVALID_RESPONSE');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      bytes += result.value.byteLength;
      if (bytes > maximumBytes) {
        await reader.cancel('OVERPASS_RESPONSE_TOO_LARGE');
        throw new Error('OVERPASS_RESPONSE_TOO_LARGE');
      }
      chunks.push(result.value);
    }
  } finally {
    reader.releaseLock();
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  } catch {
    throw new Error('OVERPASS_INVALID_RESPONSE');
  }
}

function parseCandidates(value: unknown, limit: number): NearbyStoreCandidate[] {
  if (!isRecord(value) || !Array.isArray(value['elements'])) throw new Error('OVERPASS_INVALID_RESPONSE');
  const candidates: NearbyStoreCandidate[] = [];
  for (const element of value['elements']) {
    if (candidates.length >= limit) break;
    if (!isRecord(element) || !OSM_TYPES.has(String(element['type']))) continue;
    const tags = isRecord(element['tags']) ? element['tags'] : {};
    const name = readOptionalText(tags['name'], 160);
    if (!name) continue;
    const position = readPosition(element);
    if (!position) continue;
    const id = element['id'];
    if (!(typeof id === 'number' && Number.isSafeInteger(id) && id > 0) && !(typeof id === 'string' && /^\d+$/u.test(id))) continue;
    const address = formatAddress(tags);
    candidates.push({
      osmType: String(element['type']) as NearbyStoreCandidate['osmType'],
      osmId: String(id),
      name,
      ...position,
      ...(address ? { address } : {}),
    });
  }
  return candidates;
}

function readPosition(element: Record<string, unknown>): GeoPointMicrodegrees | undefined {
  let latitude = element['lat'];
  let longitude = element['lon'];
  if ((!Number.isFinite(latitude) || !Number.isFinite(longitude)) && isRecord(element['center'])) {
    latitude = element['center']['lat'];
    longitude = element['center']['lon'];
  }
  if (typeof latitude !== 'number' || typeof longitude !== 'number' || !Number.isFinite(latitude) || !Number.isFinite(longitude)) return undefined;
  const point = {
    latitudeMicrodegrees: Math.round(latitude * 1_000_000),
    longitudeMicrodegrees: Math.round(longitude * 1_000_000),
  };
  try {
    return assertGeoPoint(point);
  } catch {
    return undefined;
  }
}

function formatAddress(tags: Record<string, unknown>): string | undefined {
  const street = readOptionalText(tags['addr:street'], 120);
  const houseNumber = readOptionalText(tags['addr:housenumber'], 32);
  const city = readOptionalText(tags['addr:city'], 120);
  const postcode = readOptionalText(tags['addr:postcode'], 32);
  const first = [street, houseNumber].filter(Boolean).join(' ');
  const second = [postcode, city].filter(Boolean).join(' ');
  const address = [first, second].filter(Boolean).join(', ');
  return address || undefined;
}

function readOptionalText(value: unknown, maximum: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim();
  return normalized && normalized.length <= maximum ? normalized : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function ensureTrailingSlash(url: URL): URL {
  return new URL(url.pathname.endsWith('/') ? url.href : `${url.href}/`);
}
