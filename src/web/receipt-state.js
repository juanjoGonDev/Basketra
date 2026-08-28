import { loadCaptures, loadReceiptExtractionJobId } from './state.js';

export const PAGE_CONCURRENCY = 2;
export const ACTIVE_PAGE_STATUSES = new Set(['preparing', 'ocr', 'ai']);
export const REVIEWABLE_PAGE_STATUSES = new Set(['completed', 'manual']);
export const PAGE_LABELS = {
  ready: 'Lista',
  pending: 'Pendiente',
  preparing: 'Preparando imagen',
  ocr: 'OCR local',
  ai: 'Verificando con IA',
  completed: 'Completada',
  manual: 'Revisión manual',
  error: 'Error',
  cancelled: 'Cancelada',
};

export const state = {
  captures: loadCaptures(),
  extraction: null,
  items: [],
  originalItems: [],
  originalText: '',
  aiConfigured: false,
  pageStates: new Map(),
  pageQueue: [],
  activePageTasks: new Map(),
  nextTaskId: 1,
  runToken: 0,
  processing: false,
  finalizing: false,
  verifyWithAi: false,
  manualReviewRequired: false,
  assemblyController: null,
  progressVisible: false,
  progressStartedAt: 0,
  progressTimer: null,
  retailerSuggestionController: null,
  retailerSuggestionTimer: null,
  retailerCandidates: new Map(),
  retailerManuallyEdited: false,
  settingRetailerValue: false,
  activeJobId: loadReceiptExtractionJobId(),
  failedBackgroundJobId: '',
  jobRealtime: null,
  expandedCaptureKey: '',
  selectedReviewCaptureKey: '',
};

export let metadata;
export let toast = () => {};

export const $ = selector => document.querySelector(selector);
export const $$ = selector => [...document.querySelectorAll(selector)];

export function configureReceiptContext(options) {
  metadata = options.metadata;
  toast = options.toast;
  state.aiConfigured = options.aiConfigured === true;
}
export function openDialog(dialog) {
  if (typeof dialog.showModal === 'function') dialog.showModal();
  else dialog.setAttribute('open', '');
}

export function closeDialog(dialog) {
  if (typeof dialog.close === 'function') dialog.close();
  else dialog.removeAttribute('open');
}

export function captureKey(capture) {
  return capture.storageKey;
}

export function captureByKey(key) {
  return state.captures.find(capture => captureKey(capture) === key);
}

export function createPageState(previous = {}) {
  return {
    status: 'ready',
    version: Number(previous.version || 0) + 1,
    startedAt: 0,
    elapsedMs: 0,
    rawText: '',
    result: null,
    error: '',
    errorCode: '',
    recovery: null,
    aiStatus: 'idle',
    aiError: '',
    aiErrorCode: '',
    aiRecovery: null,
    ...previous,
    status: 'ready',
    startedAt: 0,
    elapsedMs: 0,
    rawText: '',
    result: null,
    error: '',
    errorCode: '',
    recovery: null,
    aiStatus: 'idle',
    aiError: '',
    aiErrorCode: '',
    aiRecovery: null,
  };
}

export function ensurePageStates() {
  const currentKeys = new Set(state.captures.map(captureKey));
  for (const key of state.pageStates.keys()) {
    if (!currentKeys.has(key)) state.pageStates.delete(key);
  }
  for (const capture of state.captures) {
    const key = captureKey(capture);
    if (!state.pageStates.has(key)) state.pageStates.set(key, createPageState());
  }
}
