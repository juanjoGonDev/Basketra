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
  buildReceiptReview,
  extractReceiptMetadata,
  mergeReceiptPageItems,
  parseDeterministicReceiptText,
  verifyReceiptWithAi,
  type AiReceiptInterpretation,
  type ReceiptAiSession,
  type ReceiptExtractionItem,
  type ReceiptMetadata,
} from './extraction.ts';

const DEFAULT_PAGE_CONCURRENCY = 2;
const DEFAULT_AI_CONCURRENCY = 1;
const MAX_RECEIPT_CONVERSATION_PAGES = 20;

export type ReceiptCaptureRequest = Readonly<{
  storageKey: string;
  originalName?: string;
  embeddedText?: string;
}>;

export type ReceiptExtractionRequest = Readonly<{
  captures: readonly ReceiptCaptureRequest[];
  verifyWithAi: boolean;
}>;

export type ReceiptPageEvidence = Readonly<{
  position: number;
  storageKey: string;
  mimeType: string;
  text: string;
  confidence: number;
  source: OcrResult['source'];
  deterministic: Readonly<{
    items: readonly ReceiptExtractionItem[];
    metadata: ReceiptMetadata;
  }>;
  ai?: Readonly<{
    interpretation: AiReceiptInterpretation;
    attempts: number;
  }>;
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
  readonly #maxRetries: number;
  readonly #localOcrProvider: OcrProvider;
  readonly #pageQueue: ReceiptPageTaskQueue;
  readonly #aiQueue: ReceiptPageTaskQueue;
  #aiOcrProvider: MultimodalAiOcrProvider | undefined;

  constructor(
    fileStore: FileStore,
    getAiProvider: () => AiProvider,
    maxRetries: number,
    localOcrProvider: OcrProvider = new TesseractCliOcrProvider(),
    pageQueue: ReceiptPageTaskQueue = new ReceiptPageTaskQueue(),
    aiQueue: ReceiptPageTaskQueue = new ReceiptPageTaskQueue(DEFAULT_AI_CONCURRENCY),
  ) {
    this.#fileStore = fileStore;
    this.#getAiProvider = getAiProvider;
    this.#maxRetries = maxRetries;
    this.#localOcrProvider = localOcrProvider;
    this.#pageQueue = pageQueue;
    this.#aiQueue = aiQueue;
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
    return {
      captures,
      verifyWithAi: root['verifyWithAi'] === undefined
        ? false
        : asBoolean(root['verifyWithAi'], '$.verifyWithAi'),
    };
  }

  async extract(request: ReceiptExtractionRequest, signal?: AbortSignal): Promise<Readonly<{
    pages: readonly ReceiptPageEvidence[];
    originalText: string;
    deterministic: Readonly<{
      items: readonly ReceiptExtractionItem[];
      retailerName?: string;
      declaredTotalMinor?: number;
      articleCount?: number;
    }>;
    ai?: Readonly<{
      interpretation: AiReceiptInterpretation;
      attempts: number;
      pages: readonly Readonly<{
        position: number;
        interpretation: AiReceiptInterpretation;
        attempts: number;
      }>[];
    }>;
    final: Readonly<{
      items: readonly ReceiptExtractionItem[];
      retailerName?: string;
      declaredTotalMinor?: number;
      articleCount?: number;
      warnings: readonly string[];
      review: ReturnType<typeof buildReceiptReview>;
    }>;
  }>> {
    signal?.throwIfAborted();
    const captures = uniqueCaptures(request.captures);
    const ocrPages = captures.map((capture, position) =>
      this.#pageQueue.run(
        () => this.extractOcrPage(capture, position, signal),
        signal,
      ));
    const pages = request.verifyWithAi
      ? await this.verifyOcrPagesInOrder(captures, ocrPages, signal)
      : await Promise.all(ocrPages);
    const originalText = pages.map((page) => page.text).join('\n').trim();

    const deterministicItems = mergeReceiptPageItems(
      pages.map((page) => page.deterministic.items),
    );
    const deterministicMetadata = combineMetadata(
      pages.map((page) => page.deterministic.metadata),
    );
    const deterministic = {
      items: deterministicItems,
      ...(deterministicMetadata.retailerName
        ? { retailerName: deterministicMetadata.retailerName }
        : {}),
      ...(deterministicMetadata.declaredTotalMinor === undefined
        ? {}
        : { declaredTotalMinor: deterministicMetadata.declaredTotalMinor }),
      ...(deterministicMetadata.articleCount === undefined
        ? {}
        : { articleCount: deterministicMetadata.articleCount }),
    };

    const aiPages = pages.flatMap((page) => page.ai
      ? [{ position: page.position, ...page.ai }]
      : []);
    const aiInterpretations = aiPages.map((page) => page.interpretation);
    const aiMetadata = combineMetadata(aiInterpretations);
    const aiItemsByPage = pages.map((page) => page.ai?.interpretation.items ?? page.deterministic.items);
    const aiItems = mergeReceiptPageItems(aiItemsByPage);
    const warnings = aiInterpretations.flatMap((interpretation) => interpretation.warnings);

    let ai: Readonly<{
      interpretation: AiReceiptInterpretation;
      attempts: number;
      pages: readonly Readonly<{
        position: number;
        interpretation: AiReceiptInterpretation;
        attempts: number;
      }>[];
    }> | undefined;
    if (aiPages.length > 0) {
      ai = {
        interpretation: {
          ...(aiMetadata.retailerName ? { retailerName: aiMetadata.retailerName } : {}),
          ...(aiMetadata.declaredTotalMinor === undefined
            ? {}
            : { declaredTotalMinor: aiMetadata.declaredTotalMinor }),
          ...(aiMetadata.articleCount === undefined
            ? {}
            : { articleCount: aiMetadata.articleCount }),
          currency: 'EUR',
          correctedText: aiInterpretations.map((interpretation) => interpretation.correctedText).join('\n').trim(),
          items: aiItems,
          warnings,
        },
        attempts: aiPages.reduce((sum, page) => sum + page.attempts, 0),
        pages: aiPages,
      };
    }

    const finalItems = ai?.interpretation.items.length ? ai.interpretation.items : deterministicItems;
    const finalRetailerName = ai?.interpretation.retailerName ?? deterministicMetadata.retailerName;
    const finalTotal = ai?.interpretation.declaredTotalMinor ?? deterministicMetadata.declaredTotalMinor;
    const finalArticleCount = ai?.interpretation.articleCount ?? deterministicMetadata.articleCount;

    return {
      pages,
      originalText,
      deterministic,
      ...(ai ? { ai } : {}),
      final: {
        items: finalItems,
        ...(finalRetailerName ? { retailerName: finalRetailerName } : {}),
        ...(finalTotal === undefined ? {} : { declaredTotalMinor: finalTotal }),
        ...(finalArticleCount === undefined ? {} : { articleCount: finalArticleCount }),
        warnings,
        review: buildReceiptReview(finalItems, finalTotal),
      },
    };
  }

  dispose(): void {
    this.#pageQueue.dispose();
    this.#aiQueue.dispose();
    this.#localOcrProvider.dispose();
    this.#aiOcrProvider?.dispose();
    this.#aiOcrProvider = undefined;
  }

  private async extractOcrPage(
    capture: ReceiptCaptureRequest,
    position: number,
    signal?: AbortSignal,
  ): Promise<ReceiptOcrPageEvidence> {
    signal?.throwIfAborted();
    const stored = this.#fileStore.read(capture.storageKey);
    const result = await this.recognizeCapture(capture, stored, signal);
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

    return this.#aiQueue.run(
      () => this.getAiOcrProvider().recognize(input, signal),
      signal,
    );
  }

  private async verifyPageWithAi(
    capture: ReceiptCaptureRequest,
    page: ReceiptOcrPageEvidence,
    signal?: AbortSignal,
    session?: ReceiptAiSession,
  ): Promise<ReceiptPageEvidence> {
    const stored = this.#fileStore.read(capture.storageKey);
    const ai = await verifyReceiptWithAi(
      this.#getAiProvider(),
      this.#maxRetries,
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
    signal?: AbortSignal,
  ): Promise<ReceiptPageEvidence[]> {
    const affinity = `basketra-receipt-${randomUUID()}`;
    const verified: ReceiptPageEvidence[] = [];

    for (const [position, ocrPage] of ocrPages.entries()) {
      const page = await ocrPage;
      const capture = captures[position]!;
      verified.push(await this.#aiQueue.run(
        () => this.verifyPageWithAi(capture, page, signal, {
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

  private getAiOcrProvider(): MultimodalAiOcrProvider {
    this.#aiOcrProvider ??= new MultimodalAiOcrProvider(this.#getAiProvider(), this.#maxRetries);
    return this.#aiOcrProvider;
  }
}

function uniqueCaptures(captures: readonly ReceiptCaptureRequest[]): ReceiptCaptureRequest[] {
  const seen = new Set<string>();
  return captures.filter((capture) => {
    if (seen.has(capture.storageKey)) return false;
    seen.add(capture.storageKey);
    return true;
  });
}

function combineMetadata(values: readonly ReceiptMetadata[]): ReceiptMetadata {
  const retailerName = values.find((value) => value.retailerName)?.retailerName;
  const declaredTotalMinor = values.findLast((value) => value.declaredTotalMinor !== undefined)?.declaredTotalMinor;
  const articleCount = values.findLast((value) => value.articleCount !== undefined)?.articleCount;
  return {
    ...(retailerName ? { retailerName } : {}),
    ...(declaredTotalMinor === undefined ? {} : { declaredTotalMinor }),
    ...(articleCount === undefined ? {} : { articleCount }),
  };
}

function abortError(): DOMException {
  return new DOMException('The receipt page operation was aborted', 'AbortError');
}
