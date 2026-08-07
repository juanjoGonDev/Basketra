import { randomUUID } from 'node:crypto';

export type AiCapabilities = Readonly<{
  structuredOutput: boolean;
  jsonObject: boolean;
  image: boolean;
  pdf: boolean;
  internetSearch: boolean;
}>;

export type AiMessageContentPart =
  | Readonly<{ type: 'text'; text: string }>
  | Readonly<{ type: 'image_url'; image_url: Readonly<{ url: string; detail?: 'auto' | 'low' | 'high' }> }>
  | Readonly<{ type: 'file'; file: Readonly<{ filename: string; file_data: string }> }>;

export type AiMessageContent = string | readonly AiMessageContentPart[];

export type AiProviderErrorCode =
  | 'AI_ATTACHMENT_TOO_LARGE'
  | 'AI_ATTACHMENT_UPLOAD_FAILED'
  | 'AI_AUTHENTICATION_FAILED'
  | 'AI_EMPTY_RESPONSE'
  | 'AI_IMAGE_CAPABILITY_UNAVAILABLE'
  | 'AI_INVALID_RESPONSE'
  | 'AI_PDF_CAPABILITY_UNAVAILABLE'
  | 'AI_PROVIDER_FAILED'
  | 'AI_RATE_LIMITED'
  | 'AI_REQUEST_REJECTED'
  | 'AI_RESPONSE_TOO_LARGE'
  | 'AI_TIMEOUT'
  | 'AI_UNREACHABLE';

export class AiProviderError extends Error {
  readonly code: AiProviderErrorCode;
  readonly status?: number;
  readonly retryable: boolean;

  constructor(
    code: AiProviderErrorCode,
    options: Readonly<{ status?: number; retryable?: boolean }> = {},
  ) {
    super(code);
    this.name = 'AiProviderError';
    this.code = code;
    this.retryable = options.retryable ?? false;
    if (options.status !== undefined) this.status = options.status;
  }
}

export type AiAttachmentInput = Readonly<{
  mimeType: 'image/jpeg' | 'image/png' | 'application/pdf';
  bytes: Uint8Array;
  fileName?: string;
}>;

export function buildAiAttachmentContentPart(
  input: AiAttachmentInput,
  capabilities: AiCapabilities,
): AiMessageContentPart {
  if (input.mimeType === 'image/jpeg' || input.mimeType === 'image/png') {
    if (!capabilities.image) throw new AiProviderError('AI_IMAGE_CAPABILITY_UNAVAILABLE');
    return {
      type: 'image_url',
      image_url: {
        url: `data:${input.mimeType};base64,${Buffer.from(input.bytes).toString('base64')}`,
        detail: 'high',
      },
    };
  }
  if (!capabilities.pdf) throw new AiProviderError('AI_PDF_CAPABILITY_UNAVAILABLE');
  return {
    type: 'file',
    file: {
      filename: input.fileName?.trim() || 'receipt.pdf',
      file_data: `data:application/pdf;base64,${Buffer.from(input.bytes).toString('base64')}`,
    },
  };
}

export type AiStructuredInput = Readonly<{
  operation: string;
  systemPrompt: string;
  content: AiMessageContent;
  schemaName: string;
  jsonSchema: Readonly<Record<string, unknown>>;
  correlationId?: string;
  signal?: AbortSignal;
}>;

export type AiProviderConnectionResult = Readonly<{
  ok: boolean;
  model?: string;
  imageStructuredOutput?: boolean;
}>;

export interface AiProvider {
  getCapabilities(): Promise<AiCapabilities>;
  testConnection(signal?: AbortSignal): Promise<AiProviderConnectionResult>;
  executeStructured(input: AiStructuredInput): Promise<unknown>;
  dispose(): void;
}

const DEFAULT_CAPABILITIES: AiCapabilities = {
  structuredOutput: true,
  jsonObject: true,
  image: true,
  pdf: false,
  internetSearch: false,
};

export const DEFAULT_AI_MAX_RESPONSE_BYTES = 1024 * 1024;
const MAX_PROVIDER_ERROR_BYTES = 8 * 1024;
const CORRELATION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/u;
const PROVIDER_PROBE_PNG_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAAbklEQVR42u3QQQ0AMAgAMdTgX9C8MA17LITQS85Ao5YXAAAAAAAAAAAAAAAAAAAAAIDnTmbrAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAID/ANMDAAAAAAAAAAAAAAAAAAAAFnYBKLlvSc5qfWIAAAAASUVORK5CYII=';
const PROVIDER_PROBE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['accepted'],
  properties: {
    accepted: { type: 'boolean', enum: [true] },
  },
} as const;
const PROVIDER_ATTACHMENT_UPLOAD_CODES = new Set([
  'attachment_upload_failed',
  'composer_not_ready',
  'composer_queue_timeout',
]);
const PROVIDER_REQUEST_REJECTION_CODES = new Set([
  'attachment_input_invalid',
  'attachment_input_not_found',
  'attachment_upload_rejected',
  'structured_output_streaming_unsupported',
]);

type ProviderErrorMetadata = Readonly<{
  code?: string;
  type?: string;
}>;

function assertPositiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new RangeError(`${name} must be a positive safe integer`);
  return value;
}

async function readResponseText(response: Response, maxBytes: number): Promise<string> {
  const declaredLength = response.headers.get('content-length');
  if (declaredLength !== null) {
    const parsedLength = Number(declaredLength);
    if (Number.isFinite(parsedLength) && parsedLength > maxBytes) {
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
      if (bytes > maxBytes) {
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

async function readProviderErrorMetadata(response: Response): Promise<ProviderErrorMetadata | undefined> {
  const declaredLength = response.headers.get('content-length');
  if (declaredLength !== null) {
    const parsedLength = Number(declaredLength);
    if (Number.isFinite(parsedLength) && parsedLength > MAX_PROVIDER_ERROR_BYTES) return undefined;
  }
  if (!response.body) return undefined;

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      bytes += result.value.byteLength;
      if (bytes > MAX_PROVIDER_ERROR_BYTES) {
        await reader.cancel('PROVIDER_ERROR_BODY_LIMIT');
        return undefined;
      }
      chunks.push(result.value);
    }
  } finally {
    reader.releaseLock();
  }

  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return undefined;
    const error = (parsed as Record<string, unknown>)['error'];
    if (typeof error !== 'object' || error === null || Array.isArray(error)) return undefined;
    const record = error as Record<string, unknown>;
    const code = readBoundedProviderField(record['code']);
    const type = readBoundedProviderField(record['type']);
    return code || type ? { ...(code ? { code } : {}), ...(type ? { type } : {}) } : undefined;
  } catch {
    return undefined;
  }
}

function readBoundedProviderField(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().toLowerCase();
  return /^[a-z0-9_.-]{1,80}$/u.test(normalized) ? normalized : undefined;
}

export class OpenAiCompatibleProvider implements AiProvider {
  readonly config: Readonly<{
    baseUrl: URL;
    apiKey?: string;
    model: string;
    timeoutMs: number;
    maxResponseBytes?: number;
    capabilities?: Partial<AiCapabilities>;
  }>;
  readonly fetchImplementation: typeof fetch;
  readonly #maxResponseBytes: number;

  constructor(
    config: Readonly<{
      baseUrl: URL;
      apiKey?: string;
      model: string;
      timeoutMs: number;
      maxResponseBytes?: number;
      capabilities?: Partial<AiCapabilities>;
    }>,
    fetchImplementation: typeof fetch = fetch,
  ) {
    this.config = config;
    this.fetchImplementation = fetchImplementation;
    this.#maxResponseBytes = assertPositiveInteger(config.maxResponseBytes ?? DEFAULT_AI_MAX_RESPONSE_BYTES, 'maxResponseBytes');
  }

  async getCapabilities(): Promise<AiCapabilities> {
    return { ...DEFAULT_CAPABILITIES, ...this.config.capabilities };
  }

  async testConnection(signal?: AbortSignal): Promise<AiProviderConnectionResult> {
    const result = await this.executeStructured({
      operation: 'provider-capability-probe',
      systemPrompt: 'Inspect the attached synthetic image. Return only the requested JSON object with accepted set to true.',
      content: [
        {
          type: 'text',
          text: 'This is a synthetic Basketra provider capability probe. Confirm that the image attachment and strict structured output path completed.',
        },
        {
          type: 'image_url',
          image_url: {
            url: PROVIDER_PROBE_PNG_DATA_URL,
            detail: 'low',
          },
        },
      ],
      schemaName: 'basketra_provider_capability',
      jsonSchema: PROVIDER_PROBE_SCHEMA,
      correlationId: `provider-probe:${randomUUID()}`,
      ...(signal ? { signal } : {}),
    });

    if (!isSuccessfulProviderProbe(result)) {
      throw new AiProviderError('AI_INVALID_RESPONSE');
    }

    return {
      ok: true,
      model: this.config.model,
      imageStructuredOutput: true,
    };
  }

  async executeStructured(input: AiStructuredInput): Promise<unknown> {
    const controller = new AbortController();
    let timedOut = false;
    let timeout: NodeJS.Timeout | undefined;
    if (this.config.timeoutMs > 0) {
      timeout = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, this.config.timeoutMs);
      timeout.unref();
    }
    const signal = input.signal ? AbortSignal.any([input.signal, controller.signal]) : controller.signal;
    try {
      const response = await this.fetchImplementation(new URL('chat/completions', ensureTrailingSlash(this.config.baseUrl)), {
        method: 'POST',
        headers: { ...this.headers(input.correlationId), 'content-type': 'application/json' },
        body: JSON.stringify({
          model: this.config.model,
          messages: [
            { role: 'system', content: input.systemPrompt },
            { role: 'user', content: input.content },
          ],
          response_format: {
            type: 'json_schema',
            json_schema: { name: input.schemaName, strict: true, schema: input.jsonSchema },
          },
        }),
        signal,
      });
      if (!response.ok) {
        const metadata = await readProviderErrorMetadata(response);
        throw mapProviderHttpError(response.status, metadata);
      }
      const responseText = await readResponseText(response, this.#maxResponseBytes);
      if (!responseText) throw new AiProviderError('AI_EMPTY_RESPONSE', { retryable: true });
      const body = parseProviderJson(responseText) as { choices?: Array<{ message?: { content?: string } }> };
      const content = body.choices?.[0]?.message?.content;
      if (!content) throw new AiProviderError('AI_EMPTY_RESPONSE', { retryable: true });
      return parseProviderJson(content);
    } catch (error) {
      if (input.signal?.aborted) throw new DOMException('The AI operation was aborted', 'AbortError');
      if (timedOut) throw new AiProviderError('AI_TIMEOUT', { retryable: true });
      if (error instanceof AiProviderError) throw error;
      throw new AiProviderError('AI_UNREACHABLE', { retryable: true });
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }

  dispose(): void {}

  private headers(correlationId?: string): Record<string, string> {
    return {
      ...(this.config.apiKey ? { authorization: `Bearer ${this.config.apiKey}` } : {}),
      ...(correlationId && CORRELATION_ID_PATTERN.test(correlationId)
        ? { 'x-client-request-id': correlationId }
        : {}),
    };
  }
}

function isSuccessfulProviderProbe(value: unknown): boolean {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }

  const record = value as Record<string, unknown>;
  return Object.keys(record).length === 1 && record['accepted'] === true;
}

function mapProviderHttpError(status: number, metadata?: ProviderErrorMetadata): AiProviderError {
  const providerCode = metadata?.code ?? metadata?.type;
  if (providerCode && PROVIDER_ATTACHMENT_UPLOAD_CODES.has(providerCode)) {
    return new AiProviderError('AI_ATTACHMENT_UPLOAD_FAILED', {
      status,
      retryable: status === 503 || status === 504,
    });
  }
  if (providerCode && PROVIDER_REQUEST_REJECTION_CODES.has(providerCode)) {
    return new AiProviderError('AI_REQUEST_REJECTED', { status });
  }
  if (status === 401 || status === 403) {
    return new AiProviderError('AI_AUTHENTICATION_FAILED', { status });
  }
  if (status === 408 || status === 504) {
    return new AiProviderError('AI_TIMEOUT', { status, retryable: true });
  }
  if (status === 413) {
    return new AiProviderError('AI_ATTACHMENT_TOO_LARGE', { status });
  }
  if (status === 429) {
    return new AiProviderError('AI_RATE_LIMITED', { status, retryable: true });
  }
  if (status >= 500) {
    return new AiProviderError('AI_PROVIDER_FAILED', { status, retryable: true });
  }
  return new AiProviderError('AI_REQUEST_REJECTED', { status });
}

function parseProviderJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw new AiProviderError('AI_INVALID_RESPONSE', { retryable: true });
  }
}

function ensureTrailingSlash(url: URL): URL {
  return new URL(url.pathname.endsWith('/') ? url.href : `${url.href}/`);
}
