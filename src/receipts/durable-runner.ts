import { AiProviderError } from '../ai/provider.ts';
import type { CategoryDescriptor } from '../domain/categories.ts';
import type { ReceiptStoreDescriptor } from './stores.ts';
import type { ReceiptExtractionJobRecord } from '../infrastructure/database.ts';
import type { FileStore } from '../infrastructure/files.ts';
import { RECEIPT_SCHEMA, type AiReceiptInterpretation } from './extraction.ts';
import {
  normalizeReceiptRemoteErrorCode,
  ReceiptDurableJobStore,
  type ReceiptDurableJobState,
  type ReceiptDurablePageState,
} from './durable-job-store.ts';
import { assembleReceiptExtraction, type ReceiptExtractionResult, type ReceiptPageEvidence } from './result.ts';
import type {
  CreateReceiptResponseInput,
  ReceiptRemoteResponse,
  ReceiptResponsesClient,
} from './responses-client.ts';
import {
  RECEIPT_AI_VERIFICATION_BUDGET_MS,
  ReceiptAiVerificationTimeoutError,
  type ReceiptCaptureRequest,
  type ReceiptExtractionRequest,
  type ReceiptExtractionService,
  uniqueReceiptCaptures,
} from './service.ts';

const MAX_REMOTE_WAIT_SECONDS = 300;
const RETRY_DELAY_MS = 500;

type ReceiptResponsesTransport = Pick<ReceiptResponsesClient, 'create' | 'get' | 'cancel'>;
type RetryDelay = (milliseconds: number, signal?: AbortSignal) => Promise<void>;
type ProgressListener = (jobId: string) => void;

export type ReceiptDurableExtractionRunnerDependencies = Readonly<{
  durableStore: ReceiptDurableJobStore;
  extractionService: ReceiptExtractionService;
  fileStore: FileStore;
  responses: ReceiptResponsesTransport;
  now?: () => Date;
  retryDelay?: RetryDelay;
  onProgress?: ProgressListener;
}>;

export class ReceiptDurableExtractionRunner {
  readonly #durableStore: ReceiptDurableJobStore;
  readonly #extractionService: ReceiptExtractionService;
  readonly #fileStore: FileStore;
  readonly #responses: ReceiptResponsesTransport;
  readonly #now: () => Date;
  readonly #retryDelay: RetryDelay;
  readonly #onProgress: ProgressListener;

  constructor(dependencies: ReceiptDurableExtractionRunnerDependencies) {
    this.#durableStore = dependencies.durableStore;
    this.#extractionService = dependencies.extractionService;
    this.#fileStore = dependencies.fileStore;
    this.#responses = dependencies.responses;
    this.#now = dependencies.now ?? (() => new Date());
    this.#retryDelay = dependencies.retryDelay ?? waitForRetry;
    this.#onProgress = dependencies.onProgress ?? (() => {});
  }

  async run(
    job: Pick<ReceiptExtractionJobRecord, 'id' | 'input' | 'createdAt'>,
    signal?: AbortSignal,
  ): Promise<ReceiptExtractionResult> {
    const request = job.input as ReceiptExtractionRequest;
    if (!request.verifyWithAi) return await this.#extractionService.extract(request, signal);

    const captures = uniqueReceiptCaptures(request.captures);
    const categoryInventory = this.#extractionService.categoryInventoryFor(request);
    const storeInventory = this.#extractionService.storeInventoryFor(request);
    const existing = this.#durableStore.get(job.id);
    const state = existing ?? this.#durableStore.initialize(job.id, {
      deadlineAt: new Date(Date.parse(job.createdAt) + RECEIPT_AI_VERIFICATION_BUDGET_MS).toISOString(),
      generation: 1,
      pageCount: captures.length,
    });
    if (request.retryOfJobId && state.phase === 'queued') {
      this.#durableStore.copyReusableRetryEvidence(
        request.retryOfJobId,
        job.id,
        captures.map((capture) => capture.storageKey),
      );
      this.#onProgress(job.id);
    }
    const deadlineAt = state.deadlineAt;
    const operationSignal = signal ?? new AbortController().signal;

    try {
      const ocrPages = await this.ensureOcrPages(
        job.id,
        captures,
        deadlineAt,
        operationSignal,
      );
      this.#durableStore.markPhase(job.id, 'ai_pending');
      const verified: ReceiptPageEvidence[] = [];
      for (const [position, page] of ocrPages.entries()) {
        operationSignal.throwIfAborted();
        const interpretation = await this.ensureRemotePage(
          job.id,
          captures[position]!,
          page,
          position,
          captures.length,
          categoryInventory,
          storeInventory,
          deadlineAt,
          operationSignal,
        );
        verified.push({
          ...page,
          ai: {
            interpretation,
            attempts: 1,
          },
        });
      }
      this.#durableStore.markPhase(job.id, 'completed');
      return assembleReceiptExtraction(verified, categoryInventory);
    } catch (error) {
      if (!isAbortFromCaller(error, signal)) this.#durableStore.markPhase(job.id, 'failed');
      throw error;
    }
  }

  async cancel(jobId: string, signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted();
    const state = this.#durableStore.get(jobId);
    if (!state) return;

    for (const page of state.pages) {
      signal?.throwIfAborted();
      if (!page.responseId) continue;
      if (
        page.remoteStatus === 'completed'
        || page.remoteStatus === 'failed'
        || page.remoteStatus === 'cancelled'
        || page.remoteStatus === 'incomplete'
      ) {
        continue;
      }

      try {
        const remote = await this.#responses.cancel(page.responseId, signal);
        if (remote.status === 'cancelled') {
          this.#durableStore.saveRemoteFailure(jobId, page.position, {
            status: 'cancelled',
            errorCode: normalizeReceiptRemoteErrorCode(remote.errorCode) ?? 'REMOTE_RESPONSE_CANCELLED',
          });
          continue;
        }
        if (remote.status === 'completed' && remote.interpretation) {
          this.#durableStore.saveRemoteResult(jobId, page.position, {
            responseId: remote.id,
            status: 'completed',
            interpretation: remote.interpretation,
          });
          continue;
        }
        this.#durableStore.saveRemoteStatus(jobId, page.position, remote.status);
      } catch (error) {
        if (signal?.aborted) throw new DOMException('The receipt cancellation was aborted', 'AbortError');
        if (!(error instanceof AiProviderError)) throw error;
      }
    }

    this.#durableStore.markPhase(jobId, 'cancelled');
  }

  private async ensureOcrPages(
    jobId: string,
    captures: readonly ReceiptCaptureRequest[],
    deadlineAt: string,
    signal: AbortSignal,
  ): Promise<ReceiptPageEvidence[]> {
    this.#durableStore.markPhase(jobId, 'ocr_running');
    const before = requireState(this.#durableStore.get(jobId));
    const pending = captures.map(async (capture, position) => {
      const persisted = before.pages[position]?.ocr;
      if (persisted) return persisted;
      const page = await this.runBeforeDeadline(
        deadlineAt,
        async (deadlineSignal) =>
          await this.#extractionService.extractOcrPage(
            capture,
            position,
            deadlineSignal,
          ),
        signal,
      );
      this.#durableStore.saveOcrPage(jobId, position, page);
      this.#onProgress(jobId);
      return page;
    });
    return await Promise.all(pending);
  }

  private async ensureRemotePage(
    jobId: string,
    capture: ReceiptCaptureRequest,
    ocrPage: ReceiptPageEvidence,
    position: number,
    pageCount: number,
    categoryInventory: readonly CategoryDescriptor[],
    storeInventory: readonly ReceiptStoreDescriptor[],
    deadlineAt: string,
    signal: AbortSignal,
  ): Promise<AiReceiptInterpretation> {
    let page = requirePage(requireState(this.#durableStore.get(jobId)), position);
    if (page.remoteResult !== undefined) {
      return this.#extractionService.resolveAiCategories(RECEIPT_SCHEMA.parse(page.remoteResult));
    }

    const idempotencyKey = this.#durableStore.ensureIdempotencyKey(jobId, position);
    page = requirePage(requireState(this.#durableStore.get(jobId)), position);
    let remote: ReceiptRemoteResponse;

    if (page.responseId) {
      this.#durableStore.markPhase(jobId, 'ai_running');
      remote = await this.reconcileUntilTerminal(page.responseId, signal);
    } else {
      const stored = this.#fileStore.read(capture.storageKey);
      const createInput: CreateReceiptResponseInput = {
        idempotencyKey,
        originalText: ocrPage.text,
        attachment: {
          mimeType: stored.mimeType,
          bytes: stored.bytes,
          ...(capture.originalName ? { fileName: capture.originalName } : {}),
        },
        pageCount,
        pagePosition: position,
        categoryInventory,
        storeInventory,
        signal,
      };
      remote = await this.createWithReconciliation(createInput, deadlineAt, signal);
      this.#durableStore.saveRemoteIdentity(jobId, position, {
        responseId: remote.id,
        status: remote.status,
      });
      if (remote.status === 'queued' || remote.status === 'in_progress') {
        signal.throwIfAborted();
        this.#durableStore.markPhase(jobId, 'ai_running');
        remote = await this.reconcileUntilTerminal(remote.id, signal);
      }
    }

    if (remote.status === 'completed') {
      if (!remote.interpretation) throw new AiProviderError('AI_EMPTY_RESPONSE');
      this.#durableStore.saveRemoteResult(jobId, position, {
        responseId: remote.id,
        status: 'completed',
        interpretation: remote.interpretation,
      });
      this.#onProgress(jobId);
      return this.#extractionService.resolveAiCategories(remote.interpretation);
    }
    if (remote.status === 'queued' || remote.status === 'in_progress') {
      throw new AiProviderError('AI_PROVIDER_FAILED');
    }

    const errorCode = normalizeReceiptRemoteErrorCode(remote.errorCode) ?? remoteTerminalCode(remote.status);
    this.#durableStore.saveRemoteFailure(jobId, position, {
      status: remote.status,
      errorCode,
    });
    this.#onProgress(jobId);
    throw new AiProviderError('AI_PROVIDER_FAILED');
  }

  private async createWithReconciliation(
    input: CreateReceiptResponseInput,
    deadlineAt: string,
    signal: AbortSignal,
  ): Promise<ReceiptRemoteResponse> {
    while (true) {
      signal.throwIfAborted();
      assertBeforeDeadline(deadlineAt, this.#now());
      try {
        return await this.runBeforeDeadline(
          deadlineAt,
          async (deadlineSignal) =>
            await this.#responses.create({
              ...input,
              signal: deadlineSignal,
            }),
          signal,
        );
      } catch (error) {
        if (!isRetryableTransportError(error)) throw error;
        await this.waitBeforeRetry(deadlineAt, signal);
      }
    }
  }

  private async reconcileUntilTerminal(
    responseId: string,
    signal: AbortSignal,
  ): Promise<ReceiptRemoteResponse> {
    while (true) {
      signal.throwIfAborted();
      try {
        const response = await this.#responses.get(responseId, {
          waitSeconds: MAX_REMOTE_WAIT_SECONDS,
          signal,
        });
        if (response.status !== 'queued' && response.status !== 'in_progress') return response;
        await this.#retryDelay(RETRY_DELAY_MS, signal);
      } catch (error) {
        if (!isRetryableTransportError(error)) throw error;
        await this.#retryDelay(RETRY_DELAY_MS, signal);
      }
    }
  }

  private async waitBeforeRetry(deadlineAt: string, signal: AbortSignal): Promise<void> {
    const remainingMs = remainingMilliseconds(deadlineAt, this.#now());
    if (remainingMs <= 0) throw new ReceiptAiVerificationTimeoutError();
    await this.#retryDelay(Math.min(RETRY_DELAY_MS, remainingMs), signal);
  }

  private async runBeforeDeadline<T>(
    deadlineAt: string,
    operation: (signal: AbortSignal) => Promise<T>,
    callerSignal?: AbortSignal,
  ): Promise<T> {
    const remainingMs = remainingMilliseconds(deadlineAt, this.#now());
    if (remainingMs <= 0) throw new ReceiptAiVerificationTimeoutError();
    const deadlineController = new AbortController();
    const timer = setTimeout(() => {
      deadlineController.abort(new ReceiptAiVerificationTimeoutError());
    }, remainingMs);
    const operationSignal = callerSignal
      ? AbortSignal.any([callerSignal, deadlineController.signal])
      : deadlineController.signal;
    try {
      return await operation(operationSignal);
    } catch (error) {
      if (deadlineController.signal.aborted && !callerSignal?.aborted) {
        throw new ReceiptAiVerificationTimeoutError();
      }
      if (callerSignal?.aborted) throw new DOMException('The receipt extraction was aborted', 'AbortError');
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
}

function requireState(state: ReceiptDurableJobState | undefined): ReceiptDurableJobState {
  if (!state) throw new Error('Receipt durable state was not found');
  return state;
}

function requirePage(state: ReceiptDurableJobState, position: number): ReceiptDurablePageState {
  const page = state.pages[position];
  if (!page || page.position !== position) throw new Error('Receipt durable page was not found');
  return page;
}

function remainingMilliseconds(deadlineAt: string, now: Date): number {
  return Date.parse(deadlineAt) - now.getTime();
}

function assertBeforeDeadline(deadlineAt: string, now: Date): void {
  if (remainingMilliseconds(deadlineAt, now) <= 0) throw new ReceiptAiVerificationTimeoutError();
}

function isRetryableTransportError(error: unknown): boolean {
  return error instanceof AiProviderError && error.retryable;
}

function isAbortFromCaller(error: unknown, signal?: AbortSignal): boolean {
  return signal?.aborted === true && error instanceof Error && error.name === 'AbortError';
}

function remoteTerminalCode(status: 'failed' | 'cancelled' | 'incomplete'): string {
  switch (status) {
    case 'failed': return 'REMOTE_RESPONSE_FAILED';
    case 'cancelled': return 'REMOTE_RESPONSE_CANCELLED';
    case 'incomplete': return 'REMOTE_RESPONSE_INCOMPLETE';
  }
}

async function waitForRetry(milliseconds: number, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, milliseconds);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException('The receipt retry wait was aborted', 'AbortError'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
