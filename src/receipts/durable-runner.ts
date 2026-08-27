import { AiProviderError } from '../ai/provider.ts';
import type { ReceiptExtractionJobRecord } from '../infrastructure/database.ts';
import type { FileStore } from '../infrastructure/files.ts';
import { RECEIPT_SCHEMA, type AiReceiptInterpretation } from './extraction.ts';
import {
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

export type ReceiptDurableExtractionRunnerDependencies = Readonly<{
  durableStore: ReceiptDurableJobStore;
  extractionService: ReceiptExtractionService;
  fileStore: FileStore;
  responses: ReceiptResponsesTransport;
  now?: () => Date;
  retryDelay?: RetryDelay;
}>;

export class ReceiptDurableExtractionRunner {
  readonly #durableStore: ReceiptDurableJobStore;
  readonly #extractionService: ReceiptExtractionService;
  readonly #fileStore: FileStore;
  readonly #responses: ReceiptResponsesTransport;
  readonly #now: () => Date;
  readonly #retryDelay: RetryDelay;

  constructor(dependencies: ReceiptDurableExtractionRunnerDependencies) {
    this.#durableStore = dependencies.durableStore;
    this.#extractionService = dependencies.extractionService;
    this.#fileStore = dependencies.fileStore;
    this.#responses = dependencies.responses;
    this.#now = dependencies.now ?? (() => new Date());
    this.#retryDelay = dependencies.retryDelay ?? waitForRetry;
  }

  async run(
    job: Pick<ReceiptExtractionJobRecord, 'id' | 'input' | 'createdAt'>,
    signal?: AbortSignal,
  ): Promise<ReceiptExtractionResult> {
    const request = job.input as ReceiptExtractionRequest;
    if (!request.verifyWithAi) return await this.#extractionService.extract(request, signal);

    const captures = uniqueReceiptCaptures(request.captures);
    const existing = this.#durableStore.get(job.id);
    const state = existing ?? this.#durableStore.initialize(job.id, {
      deadlineAt: new Date(Date.parse(job.createdAt) + RECEIPT_AI_VERIFICATION_BUDGET_MS).toISOString(),
      generation: 1,
      pageCount: captures.length,
    });
    const deadlineAt = state.deadlineAt;

    try {
      return await this.runBeforeDeadline(
        deadlineAt,
        async (operationSignal) => {
          const ocrPages = await this.ensureOcrPages(job.id, captures, operationSignal);
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
          return assembleReceiptExtraction(verified);
        },
        signal,
      );
    } catch (error) {
      if (!isAbortFromCaller(error, signal)) this.#durableStore.markPhase(job.id, 'failed');
      throw error;
    }
  }

  private async ensureOcrPages(
    jobId: string,
    captures: readonly ReceiptCaptureRequest[],
    signal: AbortSignal,
  ): Promise<ReceiptPageEvidence[]> {
    this.#durableStore.markPhase(jobId, 'ocr_running');
    const before = requireState(this.#durableStore.get(jobId));
    const pending = captures.map(async (capture, position) => {
      const persisted = before.pages[position]?.ocr;
      if (persisted) return persisted;
      const page = await this.#extractionService.extractOcrPage(capture, position, signal);
      this.#durableStore.saveOcrPage(jobId, position, page);
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
    deadlineAt: string,
    signal: AbortSignal,
  ): Promise<AiReceiptInterpretation> {
    let page = requirePage(requireState(this.#durableStore.get(jobId)), position);
    if (page.remoteResult !== undefined) return RECEIPT_SCHEMA.parse(page.remoteResult);

    const idempotencyKey = this.#durableStore.ensureIdempotencyKey(jobId, position);
    page = requirePage(requireState(this.#durableStore.get(jobId)), position);
    let remote: ReceiptRemoteResponse;

    if (page.responseId) {
      this.#durableStore.markPhase(jobId, 'ai_running');
      remote = await this.reconcileUntilTerminal(page.responseId, deadlineAt, signal);
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
        remote = await this.reconcileUntilTerminal(remote.id, deadlineAt, signal);
      }
    }

    if (remote.status === 'completed') {
      if (!remote.interpretation) throw new AiProviderError('AI_EMPTY_RESPONSE');
      this.#durableStore.saveRemoteResult(jobId, position, {
        responseId: remote.id,
        status: 'completed',
        interpretation: remote.interpretation,
      });
      return remote.interpretation;
    }

    const errorCode = remote.errorCode ?? remoteTerminalCode(remote.status);
    this.#durableStore.saveRemoteFailure(jobId, position, {
      status: remote.status,
      errorCode,
    });
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
        return await this.#responses.create(input);
      } catch (error) {
        if (!isRetryableTransportError(error)) throw error;
        await this.waitBeforeRetry(deadlineAt, signal);
      }
    }
  }

  private async reconcileUntilTerminal(
    responseId: string,
    deadlineAt: string,
    signal: AbortSignal,
  ): Promise<ReceiptRemoteResponse> {
    while (true) {
      signal.throwIfAborted();
      const remainingMs = remainingMilliseconds(deadlineAt, this.#now());
      if (remainingMs <= 0) throw new ReceiptAiVerificationTimeoutError();
      const waitSeconds = Math.min(
        MAX_REMOTE_WAIT_SECONDS,
        Math.max(1, Math.ceil(remainingMs / 1000)),
      );
      try {
        const response = await this.#responses.get(responseId, { waitSeconds, signal });
        if (response.status !== 'queued' && response.status !== 'in_progress') return response;
        await this.waitBeforeRetry(deadlineAt, signal);
      } catch (error) {
        if (!isRetryableTransportError(error)) throw error;
        await this.waitBeforeRetry(deadlineAt, signal);
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

function remoteTerminalCode(status: ReceiptRemoteResponse['status']): string {
  switch (status) {
    case 'failed': return 'REMOTE_RESPONSE_FAILED';
    case 'cancelled': return 'REMOTE_RESPONSE_CANCELLED';
    case 'incomplete': return 'REMOTE_RESPONSE_INCOMPLETE';
    case 'queued':
    case 'in_progress':
    case 'completed':
      return 'REMOTE_RESPONSE_INVALID_TERMINAL_STATE';
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
