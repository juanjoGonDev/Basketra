import type {
  PersistedReceiptOcrPage,
  ReceiptDurableJobPhase,
  ReceiptDurableJobState,
  ReceiptDurablePageState,
} from './durable-job-store.ts';
import { RECEIPT_SCHEMA, type AiReceiptInterpretation } from './extraction.ts';

export const RECEIPT_JOB_PROGRESS_STAGES = ['queued', 'ocr', 'ai', 'completed', 'error'] as const;
export type ReceiptJobProgressStage = typeof RECEIPT_JOB_PROGRESS_STAGES[number];

export type ReceiptJobProgressOcr = Readonly<Pick<
  PersistedReceiptOcrPage,
  'text' | 'confidence' | 'source' | 'deterministic'
>>;

export type ReceiptJobPageProgress = Readonly<{
  position: number;
  stage: ReceiptJobProgressStage;
  ocr?: ReceiptJobProgressOcr;
  interpretation?: AiReceiptInterpretation;
}>;

export type ReceiptJobProgress = Readonly<{
  phase: ReceiptDurableJobPhase;
  pages: readonly ReceiptJobPageProgress[];
}>;

export function buildReceiptJobProgress(state: ReceiptDurableJobState): ReceiptJobProgress {
  return {
    phase: state.phase,
    pages: state.pages.map((page) => ({
      position: page.position,
      stage: pageProgressStage(page),
      ...(page.ocr ? { ocr: publicOcrEvidence(page.ocr) } : {}),
      ...(publicRemoteInterpretation(page.remoteStatus, page.remoteResult)),
    })),
  };
}

function publicRemoteInterpretation(
  status: ReceiptDurablePageState['remoteStatus'],
  value: unknown,
): Readonly<{ interpretation: AiReceiptInterpretation }> | Record<string, never> {
  if (status !== 'completed' || value === undefined) return {};
  try {
    return { interpretation: RECEIPT_SCHEMA.parse(value) };
  } catch {
    return {};
  }
}

function pageProgressStage(page: ReceiptDurablePageState): ReceiptJobProgressStage {
  switch (page.remoteStatus) {
    case 'completed':
      return 'completed';
    case 'failed':
    case 'cancelled':
    case 'incomplete':
      return 'error';
    case 'queued':
    case 'in_progress':
      return 'ai';
    case undefined:
      return isDirectPdfAwaitingValidation(page) ? 'queued' : (page.ocr ? 'ai' : 'ocr');
    default:
      return assertNever(page.remoteStatus);
  }
}

function isDirectPdfAwaitingValidation(page: ReceiptDurablePageState): boolean {
  return page.ocr?.source === 'provider' && page.ocr.text === '';
}

function assertNever(value: never): never {
  throw new Error(`Unknown receipt remote status: ${String(value)}`);
}

function publicOcrEvidence(page: PersistedReceiptOcrPage): ReceiptJobProgressOcr {
  return {
    text: page.text,
    confidence: page.confidence,
    source: page.source,
    deterministic: page.deterministic,
  };
}
