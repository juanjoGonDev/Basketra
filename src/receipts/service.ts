import { randomUUID } from 'node:crypto';
import type { AiProvider } from '../ai/provider.ts';
import { asArray, asBoolean, asRecord, asString } from '../domain/validation.ts';
import type { FileStore, StoredFileContent as StoredFile } from '../infrastructure/files.ts';
import {
  EmbeddedTextOcrProvider,
  MultimodalAiOcrProvider,
  TesseractCliOcrProvider,
  type OcrProvider,
  type OcrResult,
} from '../ocr/provider.ts';
import {
  extractReceiptMetadata,
  parseDeterministicReceiptText,
  verifyReceiptWithAi,
  type ReceiptAiSession,
} from './extraction.ts';
import {
  assembleReceiptExtraction,
  type ReceiptExtractionResult,
  type ReceiptPageEvidence,
} from './result.ts';

export type { ReceiptExtractionResult, ReceiptPageEvidence } from './result.ts';

const DEFAULT_PAGE_CONCURRENCY = 2;
const DEFAULT_AI_CONCURRENCY = 1;
const MAX_RECEIPT_CONVERSATION_PAGES = 20;
const RECEIPT_EXTRACTION_JOB_ID_PATTERN = /^receiptextractionjob_[a-z0-9]+$/iu;
export const RECEIPT_AI_VERIFICATION_BUDGET_MS = 5 * 60 * 1000;

type ReceiptExtractionServiceOptions = Readonly<{
  aiVerificationBudgetMs?: number;
}>;

type ReceiptAiRuntime = Readonly<{
  provider: AiProvider;
  maxRetries: number;
}>;

type ReceiptAiRuntimeResolver = () => ReceiptAiRuntime;

export class ReceiptAiVerificationTimeoutError extends Error {
  readonly code = 'AI_RECEIPT_TIMEOUT' as const;

  constructor() {
    super('AI_RECEIPT_TIMEOUT');
    this.name = 'ReceiptAiVerificationTimeoutError';
  }
}

export type ReceiptCaptureRequest = Readonly<{
  storageKey: string;
  originalName?: string;
  embeddedText?: string;
}>;

export type ReceiptExtractionRequest = Readonly<{
  captures: readonly ReceiptCaptureRequest[];
  verifyWithAi: boolean;
  retryOfJobId?: string;
}>;

type ReceiptOcrPageEvidence = ReceiptPageEvidence;

type QueuedPageTask<T> = {
  readonly task: () => Promise<T>;
  readonly resolve: (value: T) => void;
  readonly reject: (reason?: unknown) => void;
  readonly signal?: AbortSignal;
  readonly onAbort?: () => void;
};

export class ReceiptPageTaskQueue {
  readonly #concurrency: number;
  readonly #waiting: QueuedPageTask<unknown>[] = [];
  #active = 0;

  constructor(concurrency = DEFAULT_PAGE_CONCURRENCY) {
    if (!Number.isSafeInteger(concurrency) || concurrency < 1) {
      throw new RangeError('Receipt page concurrency must be a positive safe integer');
    }
    this.#concurrency = concurrency;
  }

  get activeCount(): number {
    return this.#active;
  }

  get waitingCount(): number {
    return this.#waiting.length;
  }

  run<T>(task: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    signal?.throwIfAborted();
    const result = new Promise<T>((resolve, reject) => {
      const entry: QueuedPageTask<T> = {
        task,
        resolve,
        reject,
        ...(signal ? { signal } : {}),
      };
      if (signal) {
        const onAbort = () => {
          const index = this.#waiting.indexOf(entry as QueuedPageTask<unknown>);
          if (index === -1) return;
          this.#waiting.splice(index, 1);
          reject(abortError());
        };
        (entry as { onAbort?: () => void }).onAbort = onAbort;
        signal.addEventListener('abort', onAbort, { once: true });
      }
      this.#waiting.push(entry as QueuedPageTask<unknown>);
      this.schedule();
    });
    void result.catch(() => {});
    return result;
  }

  dispose(): void {
    for (const entry of this.#waiting.splice(0)) {
      if (entry.onAbort) entry.signal?.removeEventListener('abort', entry.onAbort);
      entry.reject(new Error('Receipt page queue was reset'));
    }
  }

  private schedule(): void {
    while (this.#active < this.#concurrency && this.#waiting.length > 0) {
      const entry = this.#waiting.shift();
      if (!entry) return;
      if (entry.onAbort) entry.signal?.removeEventListener('abort', entry.onAbort);
      if (entry.signal?.aborted) {
        entry.reject(abortError());
        continue;
      }
      this.#active += 1;
      void entry.task()
        .then(entry.resolve, entry.reject)
        .finally(() => {
          this.#active -= 1;
          this.schedule();
        });
    }
  }
}

export class ReceiptExtractionService {
  readonly #fileStore: FileStore;
  readonly #getAiProvider: () => AiProvider;
  readonly #getMaxRetries: () => number;
  readonly #localOcrProvider: OcrProvider;
  readonly #pageQueue: ReceiptPageTaskQueue;
  readonly #aiQueue: ReceiptPageTaskQueue;
  readonly #aiVerificationBudgetMs: number;
  #multimodalOcrProvider: MultimodalAiOcrProvider | undefined;
  #multimodalOcrAiProvider: AiProvider | undefined;
  #multimodalOcrMaxRetries: number | undefined;

  constructor(
    fileStore: FileStore,
    getAiProvider: () => AiProvider,
    maxRetries: number | (() => number),
    localOcrProvider: OcrProvider = new TesseractCliOcrProvider(),
    pageQueue: ReceiptPageTaskQueue = new ReceiptPageTaskQueue(),
    aiQueue: ReceiptPageTaskQueue = new ReceiptPageTaskQueue(DEFAULT_AI_CONCURRENCY),
    options: ReceiptExtractionServiceOptions = {},
  ) {
    const aiVerificationBudgetMs = options.aiVerificationBudgetMs ?? RECEIPT_AI_VERIFICATION_BUDGET_MS;
    if (
      !Number.isSafeInteger(aiVerificationBudgetMs)
      || aiVerificationBudgetMs <= 0
      || aiVerificationBudgetMs > RECEIPT_AI_VERIFICATION_BUDGET_MS
    ) {
      throw new RangeError('Receipt AI verification budget must be between one millisecond and five minutes');
    }
    this.#fileStore = fileStore;
    this.#getAiProvider = getAiProvider;
    this.#getMaxRetries = typeof maxRetries === 'function' ? maxRetries : () => maxRetries;
    this.#localOcrProvider = localOcrProvider;
    this.#pageQueue = pageQueue;
    this.#aiQueue = aiQueue;
    this.#aiVerificationBudgetMs = aiVerificationBudgetMs;
    this.maxRetries();
  }

  parseRequest(value: unknown): ReceiptExtractionRequest {
    const root = asRecord(value);
    const captures = asArray(root['captures'], '$.captures', MAX_RECEIPT_CONVERSATION_PAGES).map((entry, index): ReceiptCaptureRequest => {
      const capture = asRecord(entry, `$.captures[${index}]`);
      const originalName = typeof capture['originalName'] === 'string'
        ? asString(capture['originalName'], `$.captures[${index}].originalName`, { min: 1, max: 240 })
        : undefined;
      const embeddedText = typeof capture['embeddedText'] === 'string'
        ? asString(capture['embeddedText'], `$.captures[${index}].embeddedText`, { min: 1, max: 500_000 })
        : undefined;
      return {
        storageKey: asString(capture['storageKey'], `$.captures[${index}].storageKey`, { min: 8, max: 160 }),
        ...(originalName ? { originalName } : {}),
        ...(embeddedText ? { embeddedText } : {}),
      };
    });
    if (captures.length === 0) throw new RangeError('At least one receipt capture is required');
    const verifyWithAi = root['verifyWithAi'] === undefined
      ? false
      : asBoolean(root['verifyWithAi'], '$.verifyWithAi');
    const retryOfJobId = root['retryOfJobId'] === undefined
      ? undefined
      : asString(root['retryOfJobId'], '$.retryOfJobId', { min: 8, max: 128 });
    if (retryOfJobId && !RECEIPT_EXTRACTION_JOB_ID_PATTERN.test(retryOfJobId)) {
      throw new RangeError('Receipt retry job id is invalid');
    }
    if (retryOfJobId && !verifyWithAi) {
      throw new RangeError('Receipt retry requires AI verification');
    }
    return {
      captures,
      verifyWithAi,
      ...(retryOfJobId ? { retryOfJobId } : {}),
    };
  }

  async extract(request: ReceiptExtractionRequest, signal?: AbortSignal): Promise<ReceiptExtractionResult> {
    signal?.throwIfAborted();
    const captures = uniqueCaptures(request.captures);
    const resolveAiRuntime = this.aiRuntimeResolver();
    const pages = request.verifyWithAi
      ? await this.runWithinAiVerificationBudget(async (verificationSignal) => {
          const ocrPages = this.queueOcrPages(captures, resolveAiRuntime, verificationSignal);
          return await this.verifyOcrPagesInOrder(captures, ocrPages, resolveAiRuntime, verificationSignal);
        }, signal)
      : await Promise.all(this.queueOcrPages(captures, resolveAiRuntime, signal));
    return assembleReceiptExtraction(pages);
  }

  async extractOcrPage(
    capture: ReceiptCaptureRequest,
    position: number,
    signal?: AbortSignal,
  ): Promise<ReceiptOcrPageEvidence> {
    return await this.queueOcrPage(capture, position, this.aiRuntimeResolver(), signal);
  }

  dispose(): void {
    this.#pageQueue.dispose();
    this.#aiQueue.dispose();
    this.#localOcrProvider.dispose();
    this.disposeMultimodalOcrProvider();
  }

  private queueOcrPages(
    captures: readonly ReceiptCaptureRequest[],
    resolveAiRuntime: ReceiptAiRuntimeResolver,
    signal?: AbortSignal,
  ): Promise<ReceiptOcrPageEvidence>[] {
    return captures.map((capture, position) => this.queueOcrPage(capture, position, resolveAiRuntime, signal));
  }

  private queueOcrPage(
    capture: ReceiptCaptureRequest,
    position: number,
    resolveAiRuntime: ReceiptAiRuntimeResolver,
    signal?: AbortSignal,
  ): Promise<ReceiptOcrPageEvidence> {
    if (!Number.isSafeInteger(position) || position < 0 || position >= MAX_RECEIPT_CONVERSATION_PAGES) {
      throw new RangeError('Receipt OCR page position is invalid');
    }
    return this.#pageQueue.run(
      () => this.readOcrPage(capture, position, resolveAiRuntime, signal),
      signal,
    );
  }

  private async runWithinAiVerificationBudget<T>(
    operation: (signal: AbortSignal) => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    signal?.throwIfAborted();
    const deadlineController = new AbortController();
    const operationSignal = signal
      ? AbortSignal.any([signal, deadlineController.signal])
      : deadlineController.signal;
    let deadlineTimer!: NodeJS.Timeout;
    const deadline = new Promise<never>((_resolve, reject) => {
      deadlineTimer = setTimeout(() => {
        reject(new ReceiptAiVerificationTimeoutError());
        deadlineController.abort();
      }, this.#aiVerificationBudgetMs);
    });

    try {
      return await Promise.race([operation(operationSignal), deadline]);
    } finally {
      clearTimeout(deadlineTimer);
    }
  }

  private async readOcrPage(
    capture: ReceiptCaptureRequest,
    position: number,
    resolveAiRuntime: ReceiptAiRuntimeResolver,
    signal?: AbortSignal,
  ): Promise<ReceiptOcrPageEvidence> {
    signal?.throwIfAborted();
    const stored = this.#fileStore.read(capture.storageKey);
    const result = await this.recognizeCapture(capture, stored, resolveAiRuntime, signal);
    const deterministicItems = parseDeterministicReceiptText(result.text);
    const metadata = extractReceiptMetadata(result.text);

    return {
      position,
      storageKey: capture.storageKey,
      mimeType: stored.mimeType,
      ...result,
      deterministic: {
        items: deterministicItems,
        metadata,
      },
    };
  }

  private async recognizeCapture(
    capture: ReceiptCaptureRequest,
    stored: StoredFile,
    resolveAiRuntime: ReceiptAiRuntimeResolver,
    signal?: AbortSignal,
  ): Promise<OcrResult> {
    if (capture.embeddedText) {
      return new EmbeddedTextOcrProvider().recognize({
        mimeType: stored.mimeType,
        bytes: stored.bytes,
        embeddedText: capture.embeddedText,
        ...(capture.originalName ? { fileName: capture.originalName } : {}),
      }, signal);
    }

    const input = {
      mimeType: stored.mimeType,
      bytes: stored.bytes,
      ...(capture.originalName ? { fileName: capture.originalName } : {}),
    };

    if (stored.mimeType === 'image/jpeg' || stored.mimeType === 'image/png') {
      return this.#localOcrProvider.recognize(input, signal);
    }

    return this.#aiQueue.run(() => {
      const { provider, maxRetries } = resolveAiRuntime();
      return this.multimodalOcrProvider(provider, maxRetries).recognize(input, signal);
    }, signal);
  }

  private multimodalOcrProvider(
    aiProvider: AiProvider,
    maxRetries: number,
  ): MultimodalAiOcrProvider {
    if (
      this.#multimodalOcrProvider
      && this.#multimodalOcrAiProvider === aiProvider
      && this.#multimodalOcrMaxRetries === maxRetries
    ) {
      return this.#multimodalOcrProvider;
    }

    this.disposeMultimodalOcrProvider();
    this.#multimodalOcrProvider = new MultimodalAiOcrProvider(aiProvider, maxRetries);
    this.#multimodalOcrAiProvider = aiProvider;
    this.#multimodalOcrMaxRetries = maxRetries;
    return this.#multimodalOcrProvider;
  }

  private disposeMultimodalOcrProvider(): void {
    this.#multimodalOcrProvider?.dispose();
    this.#multimodalOcrProvider = undefined;
    this.#multimodalOcrAiProvider = undefined;
    this.#multimodalOcrMaxRetries = undefined;
  }

  private async verifyPageWithAi(
    capture: ReceiptCaptureRequest,
    page: ReceiptOcrPageEvidence,
    resolveAiRuntime: ReceiptAiRuntimeResolver,
    signal?: AbortSignal,
    session?: ReceiptAiSession,
  ): Promise<ReceiptPageEvidence> {
    const stored = this.#fileStore.read(capture.storageKey);
    const { provider, maxRetries } = resolveAiRuntime();
    const ai = await verifyReceiptWithAi(
      provider,
      maxRetries,
      page.text,
      {
        mimeType: stored.mimeType,
        bytes: stored.bytes,
        ...(capture.originalName ? { fileName: capture.originalName } : {}),
      },
      signal,
      session,
    );

    return {
      ...page,
      ai: {
        interpretation: ai.value,
        attempts: ai.attempts,
      },
    };
  }

  private async verifyOcrPagesInOrder(
    captures: readonly ReceiptCaptureRequest[],
    ocrPages: readonly Promise<ReceiptOcrPageEvidence>[],
    resolveAiRuntime: ReceiptAiRuntimeResolver,
    signal?: AbortSignal,
  ): Promise<ReceiptPageEvidence[]> {
    const affinity = `basketra-receipt-${randomUUID()}`;
    const verified: ReceiptPageEvidence[] = [];

    for (const [position, ocrPage] of ocrPages.entries()) {
      signal?.throwIfAborted();
      const page = await ocrPage;
      const capture = captures[position]!;
      verified.push(await this.#aiQueue.run(
        () => this.verifyPageWithAi(capture, page, resolveAiRuntime, signal, {
          affinity,
          final: position === ocrPages.length - 1,
          pageCount: ocrPages.length,
          pagePosition: position,
        }),
        signal,
      ));
    }

    return verified;
  }

  private aiRuntimeResolver(): ReceiptAiRuntimeResolver {
    let runtime: ReceiptAiRuntime | undefined;
    return () => {
      if (runtime) return runtime;
      runtime = {
        provider: this.#getAiProvider(),
        maxRetries: this.maxRetries(),
      };
      return runtime;
    };
  }

  private maxRetries(): number {
    const maxRetries = this.#getMaxRetries();
    if (!Number.isSafeInteger(maxRetries) || maxRetries < 0 || maxRetries > 10) {
      throw new RangeError('AI max retries must be an integer between 0 and 10');
    }
    return maxRetries;
  }
}

export function uniqueReceiptCaptures(captures: readonly ReceiptCaptureRequest[]): ReceiptCaptureRequest[] {
  const seen = new Set<string>();
  return captures.filter((capture) => {
    if (seen.has(capture.storageKey)) return false;
    seen.add(capture.storageKey);
    return true;
  });
}

function uniqueCaptures(captures: readonly ReceiptCaptureRequest[]): ReceiptCaptureRequest[] {
  return uniqueReceiptCaptures(captures);
}

function abortError(): DOMException {
  return new DOMException('The receipt page operation was aborted', 'AbortError');
}
