import type {
  PersistedReceiptOcrPage,
  ReceiptDurableJobPhase,
  ReceiptDurableJobState,
  ReceiptDurablePageState,
} from './durable-job-store.ts';

export const RECEIPT_JOB_PROGRESS_STAGES = ['ocr', 'ai', 'completed', 'error'] as const;
export type ReceiptJobProgressStage = typeof RECEIPT_JOB_PROGRESS_STAGES[number];

export type ReceiptJobProgressOcr = Readonly<Pick<
  PersistedReceiptOcrPage,
  'text' | 'confidence' | 'source' | 'deterministic'
>>;

export type ReceiptJobPageProgress = Readonly<{
  position: number;
  stage: ReceiptJobProgressStage;
  ocr?: ReceiptJobProgressOcr;
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
    })),
  };
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
      return page.ocr ? 'ai' : 'ocr';
  }
}

function publicOcrEvidence(page: PersistedReceiptOcrPage): ReceiptJobProgressOcr {
  return {
    text: page.text,
    confidence: page.confidence,
    source: page.source,
    deterministic: page.deterministic,
  };
}