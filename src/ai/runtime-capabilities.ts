import { AiProviderError, type AiProviderRuntimeCapabilities } from './provider.ts';

const MAX_RUNTIME_CAPABILITIES_BYTES = 32 * 1024;

export async function fetchAiRuntimeCapabilities(
  input: Readonly<{
    baseUrl: URL;
    apiKey?: string;
    correlationId?: string;
    signal?: AbortSignal;
    fetchImplementation?: typeof fetch;
  }>,
): Promise<AiProviderRuntimeCapabilities | undefined> {
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
  return parseAiRuntimeCapabilities(text);
}

export function parseAiRuntimeCapabilities(
  value: string,
): AiProviderRuntimeCapabilities | undefined {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!isRecord(parsed)) return undefined;
    const attachments = parsed['attachments'];
    const execution = parsed['execution'];
    const requests = parsed['requests'];
    if (!isRecord(attachments) || !isRecord(execution) || !isRecord(requests)) {
      return undefined;
    }

    return {
      attachments: {
        maxCount: readPositiveInteger(attachments['maxCount']),
        maxFileBytes: readPositiveInteger(attachments['maxFileBytes']),
        maxImageBytes: readPositiveInteger(attachments['maxImageBytes']),
        maxSpreadsheetBytes: readPositiveInteger(attachments['maxSpreadsheetBytes']),
        maxUploadsPerThreeHours: readPositiveInteger(
          attachments['maxUploadsPerThreeHours'],
        ),
      },
      execution: {
        replyInactivityTimeoutMs: readPositiveInteger(
          execution['replyInactivityTimeoutMs'],
        ),
      },
      requests: {
        maxJsonBodyBytes: readPositiveInteger(requests['maxJsonBodyBytes']),
      },
    };
  } catch {
    return undefined;
  }
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

function ensureTrailingSlash(url: URL): URL {
  const copy = new URL(url);
  if (!copy.pathname.endsWith('/')) copy.pathname += '/';
  return copy;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readPositiveInteger(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError('Capability must be a positive safe integer');
  }
  return value;
}
