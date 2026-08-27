import { api, realtimeEndpoint } from './api.js';
import { saveReceiptExtractionJobId } from './state.js';
import {
  ACTIVE_PAGE_STATUSES,
  REVIEWABLE_PAGE_STATUSES,
  $,
  $$,
  captureKey,
  createPageState,
  ensurePageStates,
  state,
} from './receipt-state.js';
import { persistAndRenderCaptures } from './receipt-capture.js';
import { applyExtraction } from './receipt-review.js';
import {
  cancelReceiptExtraction,
  enqueueCapture,
  finishCurrentRunWhenIdle,
  pumpPageQueue,
} from './receipt-processing.js';

function abortError() {
  return new DOMException('Receipt AI correction was cancelled', 'AbortError');
}

function jobError(job, fallbackCode = 'AI_EXTRACTION_JOB_FAILED') {
  const error = new Error('Receipt AI correction did not complete');
  error.code = typeof job?.errorCode === 'string' && job.errorCode ? job.errorCode : fallbackCode;
  if (typeof job?.id === 'string' && job.id) error.jobId = job.id;
  return error;
}

function terminalJobResult(job, jobId) {
  if (!job || job.id !== jobId) return { kind: 'invalid' };
  if (job.status === 'completed') {
    return job.extraction
      ? { kind: 'completed', value: { extraction: job.extraction } }
      : { kind: 'failed', error: jobError(job, 'AI_EXTRACTION_RESULT_MISSING') };
  }
  if (job.status === 'failed') return { kind: 'failed', error: jobError(job) };
  if (job.status === 'cancelled') return { kind: 'cancelled' };
  return { kind: 'pending' };
}

function waitForAiExtractionJob(jobId, signal) {
  return new Promise((resolve, reject) => {
    const source = new EventSource(realtimeEndpoint());
    let settled = false;
    let refreshing = false;
    let refreshAgain = false;

    const cleanup = () => {
      source.close();
      signal?.removeEventListener('abort', onAbort);
    };
    const settle = callback => {
      if (settled) return;
      settled = true;
      cleanup();
      callback();
    };
    const cancelServerJob = () => {
      void api(`/api/v1/receipts/extraction-jobs/${encodeURIComponent(jobId)}`, {
        method: 'DELETE',
      }).catch(() => {});
    };
    const onAbort = () => {
      cancelServerJob();
      settle(() => reject(abortError()));
    };
    const applyJob = job => {
      const terminal = terminalJobResult(job, jobId);
      if (terminal.kind === 'completed') settle(() => resolve(terminal.value));
      else if (terminal.kind === 'failed') settle(() => reject(terminal.error));
      else if (terminal.kind === 'cancelled') settle(() => reject(abortError()));
      else if (terminal.kind === 'invalid') {
        settle(() => reject(jobError({ id: jobId }, 'AI_EXTRACTION_JOB_INVALID')));
      }
    };
    const refresh = async () => {
      if (settled) return;
      if (refreshing) {
        refreshAgain = true;
        return;
      }
      refreshing = true;
      try {
        const result = await api(`/api/v1/receipts/extraction-jobs/${encodeURIComponent(jobId)}`, { signal });
        if (!settled) applyJob(result?.job);
      } catch (error) {
        if (settled || signal?.aborted) return;
        if (Number.isInteger(error?.status) && error.status >= 400 && error.status < 500) {
          if (!error.jobId) error.jobId = jobId;
          settle(() => reject(error));
        }
        // Transient reads wait for EventSource reconnect/open instead of polling.
      } finally {
        refreshing = false;
        if (refreshAgain && !settled) {
          refreshAgain = false;
          void refresh();
        }
      }
    };

    source.addEventListener('open', () => void refresh());
    source.addEventListener('invalidate', event => {
      try {
        const invalidation = JSON.parse(event.data);
        if (invalidation?.entityType === 'receipt-extraction-job' && invalidation.entityId === jobId) {
          void refresh();
        }
      } catch {
        // Reconnect/open refresh recovers malformed or missed invalidations.
      }
    });

    if (signal?.aborted) {
      onAbort();
      return;
    }
    signal?.addEventListener('abort', onAbort, { once: true });
    void refresh();
  });
}

async function requestAiExtractionJob(captures, signal) {
  if (signal?.aborted) throw abortError();
  // Do not abort job creation once sent: the server may have persisted the job before
  // the response arrives. Waiting for its id lets an already-aborted caller delete it.
  const created = await api('/api/v1/receipts/extraction-jobs', {
    method: 'POST',
    body: JSON.stringify({ captures, verifyWithAi: true }),
  });
  const jobId = created?.job?.id;
  if (typeof jobId !== 'string' || !jobId) {
    throw jobError(undefined, 'AI_EXTRACTION_JOB_INVALID');
  }
  return waitForAiExtractionJob(jobId, signal);
}

export function abortPageWork({ markCancelled = false } = {}) {
  state.runToken += 1;
  state.pageQueue = [];
  state.assemblyController?.abort();
  state.assemblyController = null;
  state.finalizing = false;
  const obsoleteTasks = [...state.activePageTasks.values()];
  state.activePageTasks.clear();
  for (const task of obsoleteTasks) task.controller.abort();
  if (markCancelled) {
    for (const page of state.pageStates.values()) {
      if (page.status !== 'pending' && !ACTIVE_PAGE_STATUSES.has(page.status)) continue;
      page.version += 1;
      page.elapsedMs = page.startedAt ? Date.now() - page.startedAt : page.elapsedMs;
      page.error = '';
      page.errorCode = '';
      page.recovery = null;
      if (page.status === 'ai' && (page.rawText || page.result)) {
        page.status = 'completed';
        page.aiStatus = 'idle';
        page.aiError = '';
        page.aiErrorCode = '';
        page.aiRecovery = null;
      } else {
        page.status = 'cancelled';
      }
    }
  }
}

export function invalidateExtraction() {
  clearReceiptExtractionJob({ cancel: true });
  abortPageWork();
  state.processing = false;
  clearCombinedReview();
  ensurePageStates();
  for (const [key, page] of state.pageStates) state.pageStates.set(key, createPageState(page));
  $('#receipt-state').textContent = '';
  stopReceiptProgress({ hide: true });
}

export function clearCombinedReview({ keepPanel = false } = {}) {
  state.assemblyController?.abort();
  state.assemblyController = null;
  state.finalizing = false;
  state.extraction = null;
  state.items = [];
  state.originalItems = [];
  state.originalText = '';
  state.manualReviewRequired = false;
  state.retailerCandidates.clear();

  const review = $('#receipt-review');
  const confirm = $('#confirm-receipt');
  const panel = $('#receipt-review-panel');
  if (review) {
    review.hidden = true;
    review.replaceChildren();
  }
  if (confirm) confirm.hidden = true;
  if (panel && !keepPanel) {
    panel.open = false;
    panel.hidden = true;
  }
  const total = $('#receipt-total');
  if (total) total.value = '0.00';
}

export function startAutomaticCaptureProcessing(captures, { resetAll = false } = {}) {
  if (captures.length === 0) return;
  if (resetAll) {
    abortPageWork();
    ensurePageStates();
    for (const [key, page] of state.pageStates) state.pageStates.set(key, createPageState(page));
    captures = [...state.captures];
  }

  clearCombinedReview();
  ensurePageStates();
  state.verifyWithAi = state.aiConfigured && $('#verify-receipt-ai').checked;
  state.processing = true;
  if (!state.progressTimer) startReceiptProgress();

  const token = state.runToken;
  let enqueued = 0;
  for (const capture of captures) {
    const page = state.pageStates.get(captureKey(capture));
    if (!page || page.status !== 'ready') continue;
    enqueueCapture(capture, state.verifyWithAi, token);
    enqueued += 1;
  }

  persistAndRenderCaptures();
  $('#receipt-state').textContent = state.verifyWithAi
    ? 'OCR iniciado automáticamente. La IA corregirá cada imagen cuando termine su OCR; si falla, el OCR seguirá disponible.'
    : 'OCR iniciado automáticamente. Hasta dos imágenes se procesan a la vez.';
  if (enqueued === 0) void finishCurrentRunWhenIdle();
  else pumpPageQueue();
}

export function rebuildCombinedReview() {
  clearCombinedReview();
  if (state.captures.length === 0) {
    stopReceiptProgress({ hide: true });
    return;
  }
  state.processing = true;
  if (!state.progressTimer) startReceiptProgress();
  persistAndRenderCaptures();
  void finishCurrentRunWhenIdle();
}

export function requestExtraction(captures, verifyWithAi, signal) {
  if (verifyWithAi) return requestAiExtractionJob(captures, signal);
  return api('/api/v1/receipts/extract', {
    method: 'POST',
    body: JSON.stringify({ captures, verifyWithAi: false }),
    signal,
  });
}

export function clearReceiptExtractionJob({ cancel = false } = {}) {
  const jobId = state.activeJobId;
  state.jobRealtime?.close();
  state.jobRealtime = null;
  state.activeJobId = '';
  saveReceiptExtractionJobId('');
  if (cancel && jobId) void api(`/api/v1/receipts/extraction-jobs/${encodeURIComponent(jobId)}`, { method: 'DELETE' }).catch(() => {});
}

export function setPagesForBackgroundJob(status) {
  const nextStatus = status === 'running' ? (state.verifyWithAi ? 'ai' : 'ocr') : 'preparing';
  for (const page of state.pageStates.values()) {
    page.status = nextStatus;
    page.startedAt ||= Date.now();
    page.error = '';
    page.errorCode = '';
    page.recovery = null;
  }
}

export function completeBackgroundJob(extraction) {
  const pages = Array.isArray(extraction.pages) ? extraction.pages : [];
  for (const [index, capture] of state.captures.entries()) {
    const page = state.pageStates.get(captureKey(capture));
    const result = pages.find(candidate => candidate?.position === index);
    page.status = 'completed';
    page.rawText = typeof result?.text === 'string' ? result.text : '';
    page.result = extraction;
    page.aiStatus = extraction.ai ? 'completed' : 'idle';
    page.aiError = '';
    page.aiErrorCode = '';
    page.aiRecovery = null;
    page.elapsedMs = Date.now() - page.startedAt;
  }
  applyExtraction(extraction);
  state.processing = false;
  state.finalizing = false;
  stopReceiptProgress();
  persistAndRenderCaptures();
  const articleCount = extraction.final?.articleCount;
  $('#receipt-state').textContent = articleCount === undefined
    ? 'Ticket preparado. Revisa las líneas, cantidades y total antes de confirmar.'
    : `Ticket preparado. Se detectaron ${articleCount} artículos; revisa las líneas y el total.`;
}

export function failBackgroundJob(errorCode = 'RECEIPT_EXTRACTION_FAILED') {
  for (const page of state.pageStates.values()) {
    page.status = 'error';
    page.errorCode = errorCode;
    page.error = 'No se pudo completar el análisis en segundo plano. Puedes volver a intentarlo.';
    page.elapsedMs = Date.now() - page.startedAt;
  }
  state.processing = false;
  state.finalizing = false;
  stopReceiptProgress();
  persistAndRenderCaptures();
  $('#receipt-state').textContent = 'El análisis no terminó. Las capturas se conservan para reintentar.';
}

export async function refreshReceiptExtractionJob() {
  const result = await api(`/api/v1/receipts/extraction-jobs/${encodeURIComponent(state.activeJobId)}`);
  const job = result.job;
  if (!job || job.id !== state.activeJobId) return;
  if (job.status === 'queued' || job.status === 'running') {
    state.processing = true;
    setPagesForBackgroundJob(job.status);
    startReceiptProgress();
    persistAndRenderCaptures();
    return;
  }
  if (job.status === 'completed' && job.extraction) {
    completeBackgroundJob(job.extraction);
    return;
  }
  if (job.status === 'cancelled') {
    clearReceiptExtractionJob();
    cancelReceiptExtraction();
    return;
  }

  const errorCode = typeof job.errorCode === 'string' ? job.errorCode : '';
  if (errorCode.startsWith('AI_') && state.captures.length > 0) {
    clearReceiptExtractionJob();
    $('#receipt-state').textContent = 'El análisis anterior falló en la capa de IA. Recuperando las capturas con el flujo OCR actual.';
    startAutomaticCaptureProcessing(state.captures, { resetAll: true });
    return;
  }
  failBackgroundJob(errorCode || undefined);
}

export function watchReceiptExtractionJob() {
  const source = new EventSource(realtimeEndpoint());
  state.jobRealtime = source;
  source.addEventListener('invalidate', event => {
    if (state.jobRealtime !== source) return;
    try {
      const invalidation = JSON.parse(event.data);
      if (invalidation?.entityType === 'receipt-extraction-job' && invalidation.entityId === state.activeJobId) {
        void refreshReceiptExtractionJob().catch(() => {});
      }
    } catch {
      // The next valid invalidation reconnects through EventSource without leaking job contents.
    }
  });
}

export function captureRequest(capture, embeddedText) {
  return {
    storageKey: capture.storageKey,
    originalName: capture.name,
    ...(embeddedText ? { embeddedText } : {}),
  };
}

export function formatElapsed(milliseconds) {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return minutes > 0
    ? `${minutes}:${String(remainingSeconds).padStart(2, '0')}`
    : `${remainingSeconds} s`;
}

export function currentElapsed(page) {
  return ACTIVE_PAGE_STATUSES.has(page.status) && page.startedAt
    ? Date.now() - page.startedAt
    : page.elapsedMs;
}

export function startReceiptProgress() {
  state.progressVisible = true;
  state.progressStartedAt = Date.now();
  $('#receipt-progress').hidden = false;
  clearInterval(state.progressTimer);
  state.progressTimer = setInterval(() => {
    updateElapsedLabels();
    updateGlobalProgress();
  }, 1000);
  updateGlobalProgress();
}

export function stopReceiptProgress({ hide = false } = {}) {
  clearInterval(state.progressTimer);
  state.progressTimer = null;
  if (hide) {
    state.progressVisible = false;
    const progress = $('#receipt-progress');
    if (progress) progress.hidden = true;
  }
}

export function updateElapsedLabels() {
  for (const element of $$('[data-capture-elapsed]')) {
    const page = state.pageStates.get(element.dataset.captureElapsed);
    if (page) element.textContent = formatElapsed(currentElapsed(page));
  }
  if (state.progressVisible) {
    $('#receipt-progress-elapsed').textContent = formatElapsed(Date.now() - state.progressStartedAt);
  }
}

export function updateGlobalProgress() {
  const progress = $('#receipt-progress');
  if (!progress || !state.progressVisible) return;
  progress.hidden = false;
  const pages = state.captures.map(capture => state.pageStates.get(captureKey(capture)) ?? createPageState());
  const total = pages.length;
  const completed = pages.filter(page => REVIEWABLE_PAGE_STATUSES.has(page.status)).length;
  const active = pages.filter(page => ACTIVE_PAGE_STATUSES.has(page.status)).length;
  const pending = pages.filter(page => page.status === 'pending').length;
  const failed = pages.filter(page => page.status === 'error').length;
  const cancelled = pages.filter(page => page.status === 'cancelled').length;
  const manual = pages.filter(page => page.status === 'manual').length;
  const aiWarnings = pages.filter(page => page.status === 'completed' && page.aiStatus === 'error').length;
  const stage = state.finalizing
    ? 'Combinando páginas y eliminando solapamientos'
    : `${completed} de ${total} imágenes completadas`;
  $('#receipt-progress-stage').textContent = stage;
  $('#receipt-progress-captures').textContent = `${completed} de ${total} imágenes completadas`;
  $('#receipt-progress-detail').textContent = [
    active ? `${active} procesando` : '',
    pending ? `${pending} pendientes` : '',
    failed ? `${failed} con error` : '',
    cancelled ? `${cancelled} canceladas` : '',
    manual ? `${manual} en revisión manual` : '',
    aiWarnings ? `${aiWarnings} con IA pendiente` : '',
  ].filter(Boolean).join(' · ') || (state.finalizing ? 'Preparando la revisión conjunta' : 'Sin tareas pendientes');
  const track = $('#receipt-progress-track');
  track.setAttribute('aria-valuemin', '0');
  track.setAttribute('aria-valuemax', String(Math.max(total, 1)));
  track.setAttribute('aria-valuenow', String(completed));
  track.setAttribute('aria-valuetext', `${stage}. ${$('#receipt-progress-detail').textContent}`);
  track.dataset.determinate = 'true';
  track.style.setProperty('--receipt-progress', `${total === 0 ? 0 : completed / total * 100}%`);
  $('#cancel-receipt-extraction').disabled = active === 0 && pending === 0 && !state.finalizing;
}
