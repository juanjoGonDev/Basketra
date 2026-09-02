import { AiProviderError } from './provider.ts';

const MAX_RUNTIME_CAPABILITIES_BYTES = 32 * 1024;

export type WebApiRuntimeCapabilities = Readonly<{
  attachments: Readonly<{
    maxCount: number;
    maxFileBytes: number;
    maxImageBytes: number;
    maxSpreadsheetBytes: number;
    maxUploadsPerThreeHours: number;
  }>;
  execution: Readonly<{ replyInactivityTimeoutMs: number }>;
  requests: Readonly<{ maxJsonBodyBytes: number }>;
}>;

export async function fetchAiRuntimeCapabilities(
  input: Readonly<{
    baseUrl: URL;
    apiKey?: string;
    correlationId?: string;
    signal?: AbortSignal;
    fetchImplementation?: typeof fetch;
  }>,
): Promise<WebApiRuntimeCapabilities | undefined> {
  const fetchImplementation = input.fetchImplementation ?? fetch;
  let response: Response;
  try {
    response = await fetchImplementation(
      new URL('capabilities', ensureTrailingSlash(input.baseUrl)),
      {
        method: 'GET',
        headers: {
          ...(input.apiKey ? { authorization: `Bearer ${input.apiKey}` } : {}),
          ...(input.correlationId ? { 'x-client-request-id': input.correlationId } : {}),
        },
        cache: 'no-store',
        ...(input.signal ? { signal: input.signal } : {}),
      },
    );
  } catch {
    throw new AiProviderError('AI_UNREACHABLE', { retryable: true });
  }

  if (response.status === 400 || response.status === 404 || response.status === 405) {
    return undefined;
  }
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new AiProviderError('AI_AUTHENTICATION_FAILED', { status: response.status });
    }
    if (response.status === 429) {
      throw new AiProviderError('AI_RATE_LIMITED', { status: response.status, retryable: true });
    }
    throw new AiProviderError('AI_PROVIDER_FAILED', {
      status: response.status,
      retryable: response.status >= 500,
    });
  }

  const text = await readBoundedText(response);
  try {
    return parseAiRuntimeCapabilities(JSON.parse(text) as unknown);
  } catch {
    return undefined;
  }
}

export function parseAiRuntimeCapabilities(value: unknown): WebApiRuntimeCapabilities | undefined {
  if (!isRecord(value)) return undefined;
  const attachments = value['attachments'];
  const execution = value['execution'];
  const requests = value['requests'];
  if (!isRecord(attachments) || !isRecord(execution) || !isRecord(requests)) return undefined;

  const maxCount = readPositiveInteger(attachments['maxCount']);
  const maxFileBytes = readPositiveInteger(attachments['maxFileBytes']);
  const maxImageBytes = readPositiveInteger(attachments['maxImageBytes']);
  const maxSpreadsheetBytes = readPositiveInteger(attachments['maxSpreadsheetBytes']);
  const maxUploadsPerThreeHours = readPositiveInteger(attachments['maxUploadsPerThreeHours']);
  const replyInactivityTimeoutMs = readPositiveInteger(execution['replyInactivityTimeoutMs']);
  const maxJsonBodyBytes = readPositiveInteger(requests['maxJsonBodyBytes']);
  if (
    maxCount === undefined ||
    maxFileBytes === undefined ||
    maxImageBytes === undefined ||
    maxSpreadsheetBytes === undefined ||
    maxUploadsPerThreeHours === undefined ||
    replyInactivityTimeoutMs === undefined ||
    maxJsonBodyBytes === undefined
  ) {
    return undefined;
  }

  return {
    attachments: {
      maxCount,
      maxFileBytes,
      maxImageBytes,
      maxSpreadsheetBytes,
      maxUploadsPerThreeHours,
    },
    execution: { replyInactivityTimeoutMs },
    requests: { maxJsonBodyBytes },
  };
}

async function readBoundedText(response: Response): Promise<string> {
  const declaredLength = response.headers.get('content-length');
  if (declaredLength !== null) {
    const parsedLength = Number(declaredLength);
    if (Number.isFinite(parsedLength) && parsedLength > MAX_RUNTIME_CAPABILITIES_BYTES) {
      throw new AiProviderError('AI_RESPONSE_TOO_LARGE');
    }
  }

  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      bytes += result.value.byteLength;
      if (bytes > MAX_RUNTIME_CAPABILITIES_BYTES) {
        await reader.cancel('AI_RESPONSE_TOO_LARGE');
        throw new AiProviderError('AI_RESPONSE_TOO_LARGE');
      }
      chunks.push(result.value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks).toString('utf8');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readPositiveInteger(value: unknown): number | undefined {
  return Number.isSafeInteger(value) && Number(value) > 0 ? Number(value) : undefined;
}

function ensureTrailingSlash(url: URL): URL {
  const copy = new URL(url);
  if (!copy.pathname.endsWith('/')) copy.pathname += '/';
  return copy;
}
