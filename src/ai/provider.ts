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
  | Readonly<{
      type: 'image_url';
      filename?: string;
      image_url: Readonly<{ url: string; detail?: 'auto' | 'low' | 'high' }>;
    }>
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
const PROVIDER_PROBE_FILENAME = 'test.png';
const PROVIDER_PROBE_FORMAT = 'png';
const PROVIDER_PROBE_TEXT = 'BASKETRA OCR 4821';
const PROVIDER_PROBE_PNG_DATA_URL =
  'data:image/png;base64,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';
const PROVIDER_PROBE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['image'],
  properties: {
    image: {
      type: 'object',
      additionalProperties: false,
      required: ['format', 'text'],
      properties: {
        format: { type: 'string', enum: [PROVIDER_PROBE_FORMAT] },
        text: { type: 'string' },
      },
    },
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
      systemPrompt:
        'Read the visible text from the attached image. Return only the requested JSON structure. The format field must describe the attached image format and the text field must contain the exact visible text, preserving spaces and case.',
      content: [
        {
          type: 'text',
          text: 'Read the attached image. Do not infer its text from the filename, prompt, or metadata.',
        },
        {
          type: 'image_url',
          filename: PROVIDER_PROBE_FILENAME,
          image_url: {
            url: PROVIDER_PROBE_PNG_DATA_URL,
            detail: 'high',
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
        ...(input.signal ? { signal: input.signal } : {}),
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
      if (error instanceof AiProviderError) throw error;
      throw new AiProviderError('AI_UNREACHABLE', { retryable: true });
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
  if (Object.keys(record).length !== 1) return false;
  const image = record['image'];
  if (typeof image !== 'object' || image === null || Array.isArray(image)) {
    return false;
  }

  const imageRecord = image as Record<string, unknown>;
  return (
    Object.keys(imageRecord).length === 2 &&
    imageRecord['format'] === PROVIDER_PROBE_FORMAT &&
    imageRecord['text'] === PROVIDER_PROBE_TEXT
  );
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
