export const PAGE_STATUS = Object.freeze({
  READY: 'ready',
  PENDING: 'pending',
  SUBMITTING: 'submitting',
  QUEUED: 'queued',
  PREPARING: 'preparing',
  OCR: 'ocr',
  AI: 'ai',
  COMPLETED: 'completed',
  MANUAL: 'manual',
  ERROR: 'error',
  CANCELLED: 'cancelled',
});

export const ACTIVE_PAGE_STATUSES = new Set([
  PAGE_STATUS.SUBMITTING,
  PAGE_STATUS.PREPARING,
  PAGE_STATUS.OCR,
  PAGE_STATUS.AI,
]);

export const QUEUED_PAGE_STATUSES = new Set([
  PAGE_STATUS.PENDING,
  PAGE_STATUS.QUEUED,
]);

export const REVIEWABLE_PAGE_STATUSES = new Set([
  PAGE_STATUS.COMPLETED,
  PAGE_STATUS.MANUAL,
]);

export const TERMINAL_PAGE_STATUSES = new Set([
  PAGE_STATUS.COMPLETED,
  PAGE_STATUS.MANUAL,
  PAGE_STATUS.ERROR,
  PAGE_STATUS.CANCELLED,
]);

export const PAGE_LABELS = {
  [PAGE_STATUS.READY]: 'Lista',
  [PAGE_STATUS.PENDING]: 'Pendiente',
  [PAGE_STATUS.SUBMITTING]: 'Enviando a IA',
  [PAGE_STATUS.QUEUED]: 'En cola IA',
  [PAGE_STATUS.PREPARING]: 'Preparando imagen',
  [PAGE_STATUS.OCR]: 'OCR local',
  [PAGE_STATUS.AI]: 'Verificando con IA',
  [PAGE_STATUS.COMPLETED]: 'Completada',
  [PAGE_STATUS.MANUAL]: 'Revisión manual',
  [PAGE_STATUS.ERROR]: 'Error',
  [PAGE_STATUS.CANCELLED]: 'Cancelada',
};

export function isActivePageStatus(status) {
  return ACTIVE_PAGE_STATUSES.has(status);
}

export function isQueuedPageStatus(status) {
  return QUEUED_PAGE_STATUSES.has(status);
}

export function isReviewablePageStatus(status) {
  return REVIEWABLE_PAGE_STATUSES.has(status);
}

export function isTerminalPageStatus(status) {
  return TERMINAL_PAGE_STATUSES.has(status);
}

export function canApplyDurableUpdate(status) {
  return !isTerminalPageStatus(status);
}

export function durableJobStatusToPageStatus(status, { verifyWithAi = true, directPdf = false } = {}) {
  if (status === 'queued') return PAGE_STATUS.QUEUED;
  if (status === 'running') return verifyWithAi || directPdf ? PAGE_STATUS.AI : PAGE_STATUS.OCR;
  if (status === 'completed') return PAGE_STATUS.COMPLETED;
  if (status === 'failed') return PAGE_STATUS.ERROR;
  if (status === 'cancelled') return PAGE_STATUS.CANCELLED;
  return PAGE_STATUS.SUBMITTING;
}

export function durableProgressStageToPageStatus(stage, { directPdf = false } = {}) {
  if (stage === 'queued') return PAGE_STATUS.QUEUED;
  if (stage === 'ocr') return directPdf ? PAGE_STATUS.AI : PAGE_STATUS.OCR;
  if (stage === 'ai') return PAGE_STATUS.AI;
  if (stage === 'completed') return PAGE_STATUS.COMPLETED;
  if (stage === 'error') return PAGE_STATUS.ERROR;
  return undefined;
}

export function pageStageValue(status) {
  if ([PAGE_STATUS.READY, PAGE_STATUS.PENDING, PAGE_STATUS.QUEUED, PAGE_STATUS.CANCELLED, PAGE_STATUS.ERROR].includes(status)) return 0;
  if (status === PAGE_STATUS.SUBMITTING || status === PAGE_STATUS.PREPARING) return 1;
  if (status === PAGE_STATUS.OCR) return 1;
  if (status === PAGE_STATUS.AI) return 2;
  if (status === PAGE_STATUS.COMPLETED || status === PAGE_STATUS.MANUAL) return 3;
  return 0;
}
