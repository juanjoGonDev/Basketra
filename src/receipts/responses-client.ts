import { AiProviderError, type AiAttachmentInput } from '../ai/provider.ts';
import type { CategoryDescriptor } from '../domain/categories.ts';
import { asRecord } from '../domain/validation.ts';
import {
  buildReceiptCategoryContext,
  buildReceiptVerificationInstructions,
  buildNumberedReceiptText,
  RECEIPT_PAGE_VERIFICATION_SCHEMA_NAME,
  RECEIPT_SCHEMA,
  type AiReceiptInterpretation,
} from './extraction.ts';

const RESPONSE_ID_PATTERN = /^resp_[A-Za-z0-9]{7,128}$/u;
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const RESPONSE_STATUSES = [
  'queued',
  'in_progress',
  'completed',
  'failed',
  'cancelled',
  'incomplete',
] as const;
const DEFAULT_MAX_RESPONSE_BYTES = 1024 * 1024;
const MAX_WAIT_SECONDS = 300;

type ReceiptResponseStatus = typeof RESPONSE_STATUSES[number];

export type ReceiptRemoteResponse = Readonly<{
  id: string;
  status: ReceiptResponseStatus;
  interpretation?: AiReceiptInterpretation;
  errorCode?: string;
}>;

export type ReceiptResponsesClientOptions = Readonly<{
  baseUrl: URL;
  apiKey?: string;
  model: string;
  maxResponseBytes?: number;
  fetchImplementation?: typeof fetch;
}>;

export type CreateReceiptResponseInput = Readonly<{
  idempotencyKey: string;
  originalText: string;
  attachment: AiAttachmentInput;
  pageCount: number;
  pagePosition: number;
  categoryInventory?: readonly CategoryDescriptor[];
  signal?: AbortSignal;
}>;

export class ReceiptResponsesClient {
  readonly #baseUrl: URL;
  readonly #apiKey: string | undefined;
  readonly #model: string;
  readonly #maxResponseBytes: number;
  readonly #fetch: typeof fetch;
  #responseSlotTail: Promise<void> = Promise.resolve();
  readonly #responseSlotReleases = new Map<string, () => void>();

  constructor(options: ReceiptResponsesClientOptions) {
    this.#baseUrl = ensureTrailingSlash(options.baseUrl);
    this.#apiKey = options.apiKey;
    this.#model = requireNonEmptyString(options.model, 'model', 240);
    this.#maxResponseBytes = requirePositiveInteger(
      options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES,
      'maxResponseBytes',
    );
    this.#fetch = options.fetchImplementation ?? fetch;
  }

  async create(input: CreateReceiptResponseInput): Promise<ReceiptRemoteResponse> {
    if (!IDEMPOTENCY_KEY_PATTERN.test(input.idempotencyKey)) {
      throw new RangeError('Receipt response idempotency key is invalid');
    }
    requirePositiveInteger(input.pageCount, 'pageCount');
    if (!Number.isSafeInteger(input.pagePosition) || input.pagePosition < 0 || input.pagePosition >= input.pageCount) {
      throw new RangeError('pagePosition must identify a page in the receipt');
    }
    const originalText = requireNonEmptyString(input.originalText, 'originalText', 500_000);
    const releaseSlot = await this.acquireResponseSlot(input.signal);
    const body = {
      model: this.#model,
      background: true,
      store: true,
      stream: false,
      instructions: buildReceiptVerificationInstructions({
        pageCount: input.pageCount,
        pagePosition: input.pagePosition,
      }),
      input: [
        {
          role: 'user',
          content: [
            {
              type: 'input_text',
              text: [
                'Numbered OCR transcription for this same attachment:',
                buildNumberedReceiptText(originalText),
                buildReceiptCategoryContext(input.categoryInventory ?? []),
              ].join('\n'),
            },
            buildResponsesAttachment(input.attachment),
          ],
        },
      ],
      text: {
        format: {
          type: 'json_schema',
          name: RECEIPT_PAGE_VERIFICATION_SCHEMA_NAME,
          strict: true,
          schema: RECEIPT_SCHEMA.jsonSchema,
        },
      },
    } as const;

    try {
      const response = await this.request(new URL('responses', this.#baseUrl), {
        method: 'POST',
        headers: {
          ...this.headers(),
          'content-type': 'application/json',
          'idempotency-key': input.idempotencyKey,
        },
        body: JSON.stringify(body),
        ...(input.signal ? { signal: input.signal } : {}),
      });
      if (isTerminalStatus(response.status)) releaseSlot();
      else this.#responseSlotReleases.set(response.id, releaseSlot);
      return response;
    } catch (error) {
      releaseSlot();
      throw error;
    }
  }

  async get(
    responseId: string,
    options: Readonly<{ waitSeconds?: number; signal?: AbortSignal }> = {},
  ): Promise<ReceiptRemoteResponse> {
    const id = validateResponseId(responseId);
    const waitSeconds = options.waitSeconds ?? 0;
    if (!Number.isSafeInteger(waitSeconds) || waitSeconds < 0 || waitSeconds > MAX_WAIT_SECONDS) {
      throw new RangeError(`waitSeconds must be an integer between 0 and ${String(MAX_WAIT_SECONDS)}`);
    }
    const response = await this.request(new URL(`responses/${encodeURIComponent(id)}`, this.#baseUrl), {
      method: 'GET',
      headers: {
        ...this.headers(),
        ...(waitSeconds > 0 ? { prefer: `wait=${String(waitSeconds)}` } : {}),
      },
      ...(options.signal ? { signal: options.signal } : {}),
    });
    this.releaseResponseSlotIfTerminal(response);
    return response;
  }

  async cancel(responseId: string, signal?: AbortSignal): Promise<ReceiptRemoteResponse> {
    const id = validateResponseId(responseId);
    const response = await this.request(new URL(`responses/${encodeURIComponent(id)}/cancel`, this.#baseUrl), {
      method: 'POST',
      headers: this.headers(),
      ...(signal ? { signal } : {}),
    });
    this.releaseResponseSlotIfTerminal(response);
    return response;
  }

  private async acquireResponseSlot(signal?: AbortSignal): Promise<() => void> {
    const previous = this.#responseSlotTail;
    let releaseCurrent = () => {};
    const current = new Promise<void>((resolve) => {
      releaseCurrent = once(resolve);
    });
    this.#responseSlotTail = current;
    try {
      await waitForTurn(previous, signal);
      return releaseCurrent;
    } catch (error) {
      releaseCurrent();
      throw error;
    }
  }

  private releaseResponseSlotIfTerminal(response: ReceiptRemoteResponse): void {
    if (!isTerminalStatus(response.status)) return;
    const release = this.#responseSlotReleases.get(response.id);
    if (!release) return;
    this.#responseSlotReleases.delete(response.id);
    release();
  }

  private async request(url: URL, init: RequestInit): Promise<ReceiptRemoteResponse> {
    let response: Response;
    try {
      response = await this.#fetch(url, init);
    } catch (error) {
      if (init.signal?.aborted) throw new DOMException('The receipt AI request was aborted', 'AbortError');
      if (error instanceof AiProviderError) throw error;
      throw new AiProviderError('AI_UNREACHABLE', { retryable: true });
    }

    if (!response.ok) {
      throw mapResponseHttpError(response.status);
    }
    const text = await readBoundedResponseText(response, this.#maxResponseBytes);
    if (!text) throw new AiProviderError('AI_EMPTY_RESPONSE', { retryable: true });
    let parsed: unknown;
    try {
      parsed = JSON.parse(text) as unknown;
    } catch {
      throw new AiProviderError('AI_MALFORMED_PROVIDER_RESPONSE');
    }
    return parseRemoteResponse(parsed);
  }

  private headers(): Record<string, string> {
    return {
      accept: 'application/json',
      ...(this.#apiKey ? { authorization: `Bearer ${this.#apiKey}` } : {}),
    };
  }
}

function once(callback: () => void): () => void {
  let called = false;
  return () => {
    if (called) return;
    called = true;
    callback();
  };
}

async function waitForTurn(turn: Promise<void>, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  if (!signal) {
    await turn;
    return;
  }
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const settle = (callback: () => void) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', onAbort);
      callback();
    };
    const onAbort = () => settle(() => reject(new DOMException('The receipt AI queue wait was aborted', 'AbortError')));
    signal.addEventListener('abort', onAbort, { once: true });
    void turn.then(
      () => settle(resolve),
      (error) => settle(() => reject(error)),
    );
  });
}

function isTerminalStatus(status: ReceiptResponseStatus): boolean {
  return status === 'completed' || status === 'failed' || status === 'cancelled' || status === 'incomplete';
}

function buildResponsesAttachment(attachment: AiAttachmentInput): Readonly<Record<string, string>> {
  const dataUrl = `data:${attachment.mimeType};base64,${Buffer.from(attachment.bytes).toString('base64')}`;
  if (attachment.mimeType === 'image/jpeg' || attachment.mimeType === 'image/png') {
    return {
      type: 'input_image',
      image_url: dataUrl,
    };
  }
  return {
    type: 'input_file',
    filename: attachment.fileName?.trim() || 'receipt.pdf',
    file_data: dataUrl,
  };
}

function parseRemoteResponse(input: unknown): ReceiptRemoteResponse {
  const root = asRecord(input);
  if (root['object'] !== 'response') throw new AiProviderError('AI_MALFORMED_PROVIDER_RESPONSE');
  const id = validateResponseId(root['id']);
  const status = parseStatus(root['status']);
  const interpretation = status === 'completed' ? parseCompletedInterpretation(root['output']) : undefined;
  const errorCode = readBoundedErrorCode(root['error']);
  return {
    id,
    status,
    ...(interpretation ? { interpretation } : {}),
    ...(errorCode ? { errorCode } : {}),
  };
}

function parseCompletedInterpretation(output: unknown): AiReceiptInterpretation {
  if (!Array.isArray(output)) throw new AiProviderError('AI_MALFORMED_PROVIDER_RESPONSE');
  for (const item of output) {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) continue;
    const message = item as Record<string, unknown>;
    if (message['type'] !== 'message' || !Array.isArray(message['content'])) continue;
    for (const content of message['content']) {
      if (typeof content !== 'object' || content === null || Array.isArray(content)) continue;
      const part = content as Record<string, unknown>;
      if (part['type'] !== 'output_text' || typeof part['text'] !== 'string') continue;
      try {
        return RECEIPT_SCHEMA.parse(JSON.parse(part['text']) as unknown);
      } catch (error) {
        if (error instanceof AiProviderError) throw error;
        throw new AiProviderError('AI_INVALID_STRUCTURED_OUTPUT');
      }
    }
  }
  throw new AiProviderError('AI_EMPTY_RESPONSE');
}

function readBoundedErrorCode(value: unknown): string | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const code = (value as Record<string, unknown>)['code'];
  if (typeof code !== 'string') return undefined;
  const normalized = code.trim();
  return /^[A-Za-z0-9._:-]{1,80}$/u.test(normalized) ? normalized : undefined;
}

function parseStatus(value: unknown): ReceiptResponseStatus {
  if (typeof value !== 'string' || !(RESPONSE_STATUSES as readonly string[]).includes(value)) {
    throw new AiProviderError('AI_MALFORMED_PROVIDER_RESPONSE');
  }
  return value as ReceiptResponseStatus;
}

function validateResponseId(value: unknown): string {
  if (typeof value !== 'string' || !RESPONSE_ID_PATTERN.test(value)) {
    throw new AiProviderError('AI_MALFORMED_PROVIDER_RESPONSE');
  }
  return value;
}

async function readBoundedResponseText(response: Response, maxBytes: number): Promise<string> {
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

function mapResponseHttpError(status: number): AiProviderError {
  if (status === 401 || status === 403) return new AiProviderError('AI_AUTHENTICATION_FAILED', { status });
  if (status === 408 || status === 504) return new AiProviderError('AI_TIMEOUT', { status, retryable: true });
  if (status === 413) return new AiProviderError('AI_ATTACHMENT_TOO_LARGE', { status });
  if (status === 429) return new AiProviderError('AI_RATE_LIMITED', { status, retryable: true });
  if (status === 400 || status === 409 || status === 422) return new AiProviderError('AI_REQUEST_REJECTED', { status });
  if (status >= 500) return new AiProviderError('AI_PROVIDER_FAILED', { status, retryable: true });
  return new AiProviderError('AI_REQUEST_REJECTED', { status });
}

function ensureTrailingSlash(url: URL): URL {
  const normalized = new URL(url);
  if (!normalized.pathname.endsWith('/')) normalized.pathname += '/';
  return normalized;
}

function requireNonEmptyString(value: string, name: string, maxLength: number): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) {
    throw new RangeError(`${name} must contain between 1 and ${String(maxLength)} characters`);
  }
  return normalized;
}

function requirePositiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new RangeError(`${name} must be a positive safe integer`);
  return value;
}
