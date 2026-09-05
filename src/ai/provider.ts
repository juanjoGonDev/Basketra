import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

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
  | 'AI_INVALID_STRUCTURED_OUTPUT'
  | 'AI_MALFORMED_PROVIDER_RESPONSE'
  | 'AI_PDF_CAPABILITY_UNAVAILABLE'
  | 'AI_PROBE_TEXT_MISMATCH'
  | 'AI_PROVIDER_FAILED'
  | 'AI_RATE_LIMITED'
  | 'AI_REQUEST_REJECTED'
  | 'AI_RESPONSE_TOO_LARGE'
  | 'AI_TIMEOUT'
  | 'AI_UNREACHABLE';

export type AiRetryScope = 'continuation_only';

export class AiProviderError extends Error {
  readonly code: AiProviderErrorCode;
  readonly status?: number;
  readonly retryable: boolean;
  readonly originalRequestReplaySafe?: false;
  readonly retryScope?: AiRetryScope;

  constructor(
    code: AiProviderErrorCode,
    options: Readonly<{
      status?: number;
      retryable?: boolean;
      originalRequestReplaySafe?: false;
      retryScope?: AiRetryScope;
    }> = {},
  ) {
    super(code);
    this.name = 'AiProviderError';
    this.code = code;
    this.retryable = options.retryable ?? false;
    if (options.status !== undefined) this.status = options.status;
    if (options.originalRequestReplaySafe === false) {
      this.originalRequestReplaySafe = false;
    }
    if (options.retryScope !== undefined) this.retryScope = options.retryScope;
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
      filename:
        input.fileName?.trim() || (input.mimeType === 'image/jpeg' ? 'image.jpg' : 'image.png'),
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

export type AiReasoningEffort = 'low' | 'medium' | 'high';

export type AiStructuredInput = Readonly<{
  operation: string;
  systemPrompt: string;
  content: AiMessageContent;
  schemaName: string;
  jsonSchema: Readonly<Record<string, unknown>>;
  reasoningEffort?: AiReasoningEffort;
  correlationId?: string;
  sessionAffinity?: string;
  sessionFinal?: boolean;
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

export type AiProviderRuntimeCapabilities = Readonly<{
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

const DEFAULT_CAPABILITIES: AiCapabilities = {
  structuredOutput: true,
  jsonObject: true,
  image: true,
  pdf: false,
  internetSearch: false,
};

export const DEFAULT_AI_MAX_RESPONSE_BYTES = 1024 * 1024;
const MAX_PROVIDER_ERROR_BYTES = 8 * 1024;
const MAX_RUNTIME_CAPABILITIES_BYTES = 32 * 1024;
const CORRELATION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/u;
const SESSION_AFFINITY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const PROVIDER_PROBE_FILENAME = 'test.jpg';
const PROVIDER_PROBE_FORMAT = 'jpg';
const PROVIDER_PROBE_TEXT = 'BASKETRA OCR 4821';
const PROVIDER_PROBE_JPEG_PATH = fileURLToPath(
  new URL('./fixtures/provider-probe.jpg', import.meta.url),
);
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
  originalRequestReplaySafe?: false;
  retryScope?: AiRetryScope;
}>;

type BinaryMultipartAttachment = Readonly<{
  bytes: Buffer;
  fileName: string;
  mimeType: string;
}>;

type ProviderRequest = Readonly<{
  body: BodyInit;
  contentType?: string;
  jsonBytes: number;
}>;

function assertPositiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new RangeError(`${name} must be a positive safe integer`);
  return value;
}

function buildProviderProbeJpegDataUrl(): string {
  const bytes = readFileSync(PROVIDER_PROBE_JPEG_PATH);
  return `data:image/jpeg;base64,${Buffer.from(bytes).toString('base64')}`;
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
    const details = isRecord(record['details']) ? record['details'] : undefined;
    const replayUnsafe =
      details?.['originalRequestReplaySafe'] === false &&
      details['retryScope'] === 'continuation_only';
    return code || type || replayUnsafe
      ? {
          ...(code ? { code } : {}),
          ...(type ? { type } : {}),
          ...(replayUnsafe
            ? {
                originalRequestReplaySafe: false as const,
                retryScope: 'continuation_only' as const,
              }
            : {}),
        }
      : undefined;
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
            url: buildProviderProbeJpegDataUrl(),
            detail: 'high',
          },
        },
      ],
      schemaName: 'basketra_provider_capability',
      jsonSchema: PROVIDER_PROBE_SCHEMA,
      correlationId: `provider-probe:${randomUUID()}`,
      ...(signal ? { signal } : {}),
    });

    const probeFailure = providerProbeFailure(result);
    if (probeFailure) {
      throw new AiProviderError(probeFailure);
    }

    return {
      ok: true,
      model: this.config.model,
      imageStructuredOutput: true,
    };
  }

  async executeStructured(input: AiStructuredInput): Promise<unknown> {
    try {
      const runtimeCapabilities = await this.fetchRuntimeCapabilities(input.signal);
      assertContentWithinRuntimeCapabilities(input.content, runtimeCapabilities);
      const providerRequest = buildProviderRequest(input, this.config.model);
      if (
        runtimeCapabilities !== undefined &&
        providerRequest.jsonBytes > runtimeCapabilities.requests.maxJsonBodyBytes
      ) {
        throw new AiProviderError('AI_ATTACHMENT_TOO_LARGE', { status: 413 });
      }

      const response = await this.fetchImplementation(new URL('chat/completions', ensureTrailingSlash(this.config.baseUrl)), {
        method: 'POST',
        headers: {
          ...this.headers(input.correlationId, input.sessionAffinity, input.sessionFinal),
          ...(providerRequest.contentType ? { 'content-type': providerRequest.contentType } : {}),
        },
        body: providerRequest.body,
        ...(input.signal ? { signal: input.signal } : {}),
      });
      if (!response.ok) {
        const metadata = await readProviderErrorMetadata(response);
        throw mapProviderHttpError(response.status, metadata);
      }
      const responseText = await readResponseText(response, this.#maxResponseBytes);
      if (!responseText) throw new AiProviderError('AI_EMPTY_RESPONSE', { retryable: true });
      const isCapabilityProbe = input.operation === 'provider-capability-probe';
      const body = parseProviderJson(
        responseText,
        isCapabilityProbe ? 'AI_MALFORMED_PROVIDER_RESPONSE' : 'AI_INVALID_RESPONSE',
      ) as { choices?: Array<{ message?: { content?: string } }> };
      const content = body.choices?.[0]?.message?.content;
      if (!content) throw new AiProviderError('AI_EMPTY_RESPONSE', { retryable: true });
      return parseProviderJson(
        content,
        isCapabilityProbe ? 'AI_INVALID_STRUCTURED_OUTPUT' : 'AI_INVALID_RESPONSE',
      );
    } catch (error) {
      if (input.signal?.aborted) throw new DOMException('The AI operation was aborted', 'AbortError');
      if (error instanceof AiProviderError) throw error;
      throw new AiProviderError('AI_UNREACHABLE', { retryable: true });
    }
  }

  dispose(): void {}

  private async fetchRuntimeCapabilities(signal?: AbortSignal): Promise<AiProviderRuntimeCapabilities | undefined> {
    const response = await this.fetchImplementation(new URL('capabilities', ensureTrailingSlash(this.config.baseUrl)), {
      method: 'GET',
      headers: this.headers(),
      ...(signal ? { signal } : {}),
    });

    if (response.status === 400 || response.status === 404 || response.status === 405) return undefined;
    if (!response.ok) {
      const metadata = await readProviderErrorMetadata(response);
      throw mapProviderHttpError(response.status, metadata);
    }

    try {
      const text = await readResponseText(response, MAX_RUNTIME_CAPABILITIES_BYTES);
      return parseRuntimeCapabilities(text);
    } catch (error) {
      if (error instanceof AiProviderError && error.code === 'AI_RESPONSE_TOO_LARGE') return undefined;
      throw error;
    }
  }

  private headers(correlationId?: string, sessionAffinity?: string, sessionFinal?: boolean): Record<string, string> {
    const candidate = sessionAffinity?.trim();
    const affinity = candidate && SESSION_AFFINITY_PATTERN.test(candidate) ? candidate : undefined;
    return {
      ...(this.config.apiKey ? { authorization: `Bearer ${this.config.apiKey}` } : {}),
      ...(correlationId && CORRELATION_ID_PATTERN.test(correlationId)
        ? { 'x-client-request-id': correlationId }
        : {}),
      ...(affinity ? { 'x-session-affinity': affinity, 'x-session-affinity-keep-open': 'true' } : {}),
      ...(affinity && sessionFinal ? { 'x-session-affinity-final': 'true' } : {}),
    };
  }
}

function buildProviderRequest(input: AiStructuredInput, model: string): ProviderRequest {
  const extracted = extractBinaryAttachments(input.content);
  const metadata = {
    model,
    messages: [
      { role: 'system', content: input.systemPrompt },
      { role: 'user', content: extracted.content },
    ],
    response_format: {
      type: 'json_schema',
      json_schema: { name: input.schemaName, strict: true, schema: input.jsonSchema },
    },
    ...(input.reasoningEffort ? { reasoning: { effort: input.reasoningEffort } } : {}),
  };
  const requestJson = JSON.stringify(metadata);
  const jsonBytes = Buffer.byteLength(requestJson, 'utf8');

  if (extracted.attachments.length === 0) {
    return {
      body: requestJson,
      contentType: 'application/json',
      jsonBytes,
    };
  }

  const form = new FormData();
  form.set('request', requestJson);
  for (const attachment of extracted.attachments) {
    form.append(
      'files',
      new Blob([Uint8Array.from(attachment.bytes)], { type: attachment.mimeType }),
      attachment.fileName,
    );
  }

  return { body: form, jsonBytes };
}

function extractBinaryAttachments(content: AiMessageContent): Readonly<{
  attachments: readonly BinaryMultipartAttachment[];
  content: AiMessageContent;
}> {
  if (typeof content === 'string') return { attachments: [], content };

  const attachments: BinaryMultipartAttachment[] = [];
  const metadataParts: AiMessageContentPart[] = [];
  for (const [index, part] of content.entries()) {
    if (part.type === 'text') {
      metadataParts.push(part);
      continue;
    }

    if (part.type === 'image_url') {
      const decoded = decodeDataUrl(part.image_url.url);
      if (decoded === undefined) {
        metadataParts.push(part);
        continue;
      }
      attachments.push({
        bytes: decoded.bytes,
        fileName: part.filename?.trim() || defaultFileName(decoded.mimeType, index),
        mimeType: decoded.mimeType,
      });
      continue;
    }

    const decoded = decodeDataUrl(part.file.file_data);
    if (decoded === undefined) {
      metadataParts.push(part);
      continue;
    }
    attachments.push({
      bytes: decoded.bytes,
      fileName: part.file.filename.trim() || defaultFileName(decoded.mimeType, index),
      mimeType: decoded.mimeType,
    });
  }

  return { attachments, content: metadataParts };
}

function decodeDataUrl(value: string): Readonly<{ bytes: Buffer; mimeType: string }> | undefined {
  const match = /^data:([^;,]+);base64,([A-Za-z0-9+/]*={0,2})$/u.exec(value);
  if (!match?.[1] || match[2] === undefined) return undefined;
  return {
    bytes: Buffer.from(match[2], 'base64'),
    mimeType: match[1].trim().toLowerCase(),
  };
}

function defaultFileName(mimeType: string, index: number): string {
  const extension = mimeType === 'image/jpeg'
    ? 'jpg'
    : mimeType === 'image/png'
      ? 'png'
      : mimeType === 'application/pdf'
        ? 'pdf'
        : 'bin';
  return `attachment-${index.toString()}.${extension}`;
}

function parseRuntimeCapabilities(value: string): AiProviderRuntimeCapabilities | undefined {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!isRecord(parsed)) return undefined;
    const attachments = parsed['attachments'];
    const execution = parsed['execution'];
    const requests = parsed['requests'];
    if (!isRecord(attachments) || !isRecord(execution) || !isRecord(requests)) return undefined;

    return {
      attachments: {
        maxCount: readPositiveInteger(attachments['maxCount']),
        maxFileBytes: readPositiveInteger(attachments['maxFileBytes']),
        maxImageBytes: readPositiveInteger(attachments['maxImageBytes']),
        maxSpreadsheetBytes: readPositiveInteger(attachments['maxSpreadsheetBytes']),
        maxUploadsPerThreeHours: readPositiveInteger(attachments['maxUploadsPerThreeHours']),
      },
      execution: {
        replyInactivityTimeoutMs: readPositiveInteger(execution['replyInactivityTimeoutMs']),
      },
      requests: {
        maxJsonBodyBytes: readPositiveInteger(requests['maxJsonBodyBytes']),
      },
    };
  } catch {
    return undefined;
  }
}

function assertContentWithinRuntimeCapabilities(
  content: AiMessageContent,
  capabilities: AiProviderRuntimeCapabilities | undefined,
): void {
  if (capabilities === undefined || typeof content === 'string') return;

  let attachmentCount = 0;
  for (const part of content) {
    if (part.type === 'image_url') {
      attachmentCount += 1;
      if (readDataUrlBytes(part.image_url.url) > capabilities.attachments.maxImageBytes) {
        throw new AiProviderError('AI_ATTACHMENT_TOO_LARGE', { status: 413 });
      }
      continue;
    }
    if (part.type === 'file') {
      attachmentCount += 1;
      if (readDataUrlBytes(part.file.file_data) > capabilities.attachments.maxFileBytes) {
        throw new AiProviderError('AI_ATTACHMENT_TOO_LARGE', { status: 413 });
      }
    }
  }

  if (attachmentCount > capabilities.attachments.maxCount) {
    throw new AiProviderError('AI_ATTACHMENT_TOO_LARGE', { status: 413 });
  }
}

function readDataUrlBytes(value: string): number {
  const decoded = decodeDataUrl(value);
  if (decoded === undefined) return 0;
  return decoded.bytes.byteLength;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readPositiveInteger(value: unknown): number {
  if (typeof value !== 'number') throw new RangeError('Capability must be a positive safe integer');
  if (value <= 0 || !Number.isSafeInteger(value)) throw new RangeError('Capability must be a positive safe integer');
  return value;
}

function providerProbeFailure(value: unknown): AiProviderErrorCode | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return 'AI_INVALID_STRUCTURED_OUTPUT';
  }

  const record = value as Record<string, unknown>;
  if (Object.keys(record).length !== 1) return 'AI_INVALID_STRUCTURED_OUTPUT';
  const image = record['image'];
  if (typeof image !== 'object' || image === null || Array.isArray(image)) {
    return 'AI_INVALID_STRUCTURED_OUTPUT';
  }

  const imageRecord = image as Record<string, unknown>;
  if (Object.keys(imageRecord).length !== 2 || imageRecord['format'] !== PROVIDER_PROBE_FORMAT) {
    return 'AI_INVALID_STRUCTURED_OUTPUT';
  }
  return imageRecord['text'] === PROVIDER_PROBE_TEXT ? undefined : 'AI_PROBE_TEXT_MISMATCH';
}

function mapProviderHttpError(status: number, metadata?: ProviderErrorMetadata): AiProviderError {
  const providerCode = metadata?.code ?? metadata?.type;
  const replaySafety = metadata?.originalRequestReplaySafe === false
    ? {
        originalRequestReplaySafe: false as const,
        retryScope: 'continuation_only' as const,
      }
    : {};
  if (providerCode && PROVIDER_ATTACHMENT_UPLOAD_CODES.has(providerCode)) {
    return new AiProviderError('AI_ATTACHMENT_UPLOAD_FAILED', {
      status,
      retryable: status === 503 || status === 504,
      ...replaySafety,
    });
  }
  if (providerCode && PROVIDER_REQUEST_REJECTION_CODES.has(providerCode)) {
    return new AiProviderError('AI_REQUEST_REJECTED', { status, ...replaySafety });
  }
  if (status === 401 || status === 403) {
    return new AiProviderError('AI_AUTHENTICATION_FAILED', { status, ...replaySafety });
  }
  if (status === 408 || status === 504) {
    return new AiProviderError('AI_TIMEOUT', {
      status,
      retryable: true,
      ...replaySafety,
    });
  }
  if (status === 413) {
    return new AiProviderError('AI_ATTACHMENT_TOO_LARGE', { status, ...replaySafety });
  }
  if (status === 429) {
    return new AiProviderError('AI_RATE_LIMITED', {
      status,
      retryable: true,
      ...replaySafety,
    });
  }
  if (status >= 500) {
    return new AiProviderError('AI_PROVIDER_FAILED', {
      status,
      retryable: true,
      ...replaySafety,
    });
  }
  return new AiProviderError('AI_REQUEST_REJECTED', { status, ...replaySafety });
}

function parseProviderJson(value: string, errorCode: AiProviderErrorCode): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw new AiProviderError(errorCode, { retryable: true });
  }
}

function ensureTrailingSlash(url: URL): URL {
  return new URL(url.pathname.endsWith('/') ? url.href : `${url.href}/`);
}
