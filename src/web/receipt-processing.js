import { buildReceiptAiRecovery } from './receipt-ai-recovery.js';
import { minorToEuroInput } from './ui.js';
import {
  PAGE_CONCURRENCY,
  REVIEWABLE_PAGE_STATUSES,
  $,
  captureByKey,
  captureKey,
  createPageState,
  state,
} from './receipt-state.js';
import { persistAndRenderCaptures } from './receipt-capture.js';
import {
  abortPageWork,
  captureRequest,
  clearCombinedReview,
  clearReceiptExtractionJob,
  requestExtraction,
  retryFailedReceiptExtractionJob,
  startReceiptProgress,
  stopReceiptProgress,
  updateGlobalProgress,
} from './receipt-lifecycle.js';
import {
  applyExtraction,
  applyRetailerCandidate,
  renderReviewReference,
  showReviewPanelForCapture,
} from './receipt-review.js';

export function enqueueCapture(capture, verifyWithAi, token = state.runToken, mode = 'full') {
  const page = state.pageStates.get(captureKey(capture));
  if (!page) return;
  page.status = 'pending';
  state.pageQueue.push({
    key: captureKey(capture),
    version: page.version,
    token,
    verifyWithAi,
    mode,
  });
}

export function currentActivePageCount() {
  return [...state.activePageTasks.values()]
    .filter(task => task.token === state.runToken)
    .length;
}

export function pumpPageQueue() {
  while (currentActivePageCount() < PAGE_CONCURRENCY && state.pageQueue.length > 0) {
    const entry = state.pageQueue.shift();
    if (!entry || entry.token !== state.runToken) continue;
    const capture = captureByKey(entry.key);
    const page = state.pageStates.get(entry.key);
    if (!capture || !page || page.version !== entry.version || page.status !== 'pending') continue;
    if ([...state.activePageTasks.values()].some(task => task.token === entry.token && task.key === entry.key)) {
      state.pageQueue.push(entry);
      break;
    }
    startPageTask(capture, entry);
  }
  void finishCurrentRunWhenIdle();
}

export function startPageTask(capture, entry) {
  const controller = new AbortController();
  const taskId = state.nextTaskId;
  state.nextTaskId += 1;
  state.activePageTasks.set(taskId, { key: entry.key, token: entry.token, controller });
  void processCapture(capture, entry, controller.signal)
    .finally(() => {
      state.activePageTasks.delete(taskId);
      pumpPageQueue();
      updateGlobalProgress();
    });
}

export function recordAiFailure(page, capture, error) {
  const recovery = buildReceiptAiRecovery(error, {
    mimeType: capture.mimeType,
    hasOcrDraft: Boolean(page.rawText || page.result),
  });
  page.aiStatus = 'error';
  page.aiErrorCode = typeof error.code === 'string' ? error.code : '';
  page.aiError = 'La IA no pudo corregir esta imagen. El OCR local se conserva: puedes revisarlo manualmente o volver a intentar sólo la IA.';
  page.aiRecovery = {
    ...recovery,
    message: page.aiError,
    retryLabel: 'Volver a analizar con IA',
    manualLabel: 'Revisar manualmente',
    allowManualReview: true,
  };
  state.expandedCaptureKey ||= captureKey(capture);
}

export function clearAiFailure(page) {
  page.aiStatus = 'completed';
  page.aiError = '';
  page.aiErrorCode = '';
  page.aiRecovery = null;
}

export async function runAiCorrection(capture, page, entry, signal) {
  page.status = 'ai';
  page.aiStatus = 'running';
  page.aiError = '';
  page.aiErrorCode = '';
  page.aiRecovery = null;
  persistAndRenderCaptures();

  try {
    const aiResponse = await requestExtraction(
      [captureRequest(capture, page.rawText)],
      true,
      signal,
    );
    if (!isCurrentPageEntry(page, entry) || signal.aborted) return false;
    page.result = aiResponse.extraction;
    clearAiFailure(page);
    if (state.expandedCaptureKey === captureKey(capture)) state.expandedCaptureKey = '';
    return true;
  } catch (error) {
    if (error.name === 'AbortError') throw error;
    if (!isCurrentPageEntry(page, entry)) return false;
    recordAiFailure(page, capture, error);
    return false;
  }
}

export async function processAiOnlyCapture(capture, page, entry, signal) {
  page.startedAt = Date.now();
  page.elapsedMs = 0;
  page.error = '';
  page.errorCode = '';
  page.recovery = null;
  const hasOcrDraft = Boolean(page.rawText || page.result);
  const canAnalyzeAttachmentDirectly = capture.mimeType === 'application/pdf';
  if (!hasOcrDraft && !canAnalyzeAttachmentDirectly) {
    throw new Error('No hay OCR conservado para corregir con IA');
  }

  const corrected = await runAiCorrection(capture, page, entry, signal);
  if (!isCurrentPageEntry(page, entry) || signal.aborted) return;
  page.elapsedMs = Date.now() - page.startedAt;
  if (!corrected && !hasOcrDraft) {
    page.status = 'error';
    page.errorCode = page.aiErrorCode;
    page.error = page.aiError;
    page.recovery = page.aiRecovery;
    return;
  }

  page.status = 'completed';
  applyRetailerCandidate(
    page.result?.final?.retailerName
    || page.result?.ai?.interpretation?.retailerName
    || page.result?.deterministic?.retailerName,
  );
}

export async function processCapture(capture, entry, signal) {
  const page = state.pageStates.get(entry.key);
  if (!page || !isCurrentPageEntry(page, entry)) return;

  if (entry.mode === 'ai-only') {
    try {
      await processAiOnlyCapture(capture, page, entry, signal);
    } catch (error) {
      if (!isCurrentPageEntry(page, entry)) return;
      page.elapsedMs = Date.now() - page.startedAt;
      if (error.name === 'AbortError') {
        page.status = page.rawText || page.result ? 'completed' : 'cancelled';
        page.aiStatus = 'idle';
      } else {
        page.status = page.rawText || page.result ? 'completed' : 'error';
        if (page.status === 'completed') recordAiFailure(page, capture, error);
        else {
          page.errorCode = typeof error.code === 'string' ? error.code : '';
          page.recovery = buildReceiptAiRecovery(error, {
            mimeType: capture.mimeType,
            hasOcrDraft: false,
          });
          page.error = page.recovery.message;
        }
      }
    } finally {
      if (isCurrentPageEntry(page, entry)) persistAndRenderCaptures();
    }
    return;
  }

  page.status = 'preparing';
  page.startedAt = Date.now();
  page.elapsedMs = 0;
  page.error = '';
  page.errorCode = '';
  page.recovery = null;
  page.aiStatus = 'idle';
  page.aiError = '';
  page.aiErrorCode = '';
  page.aiRecovery = null;
  persistAndRenderCaptures();

  try {
    page.status = 'ocr';
    persistAndRenderCaptures();
    const ocrResponse = await requestExtraction([captureRequest(capture)], false, signal);
    if (!isCurrentPageEntry(page, entry) || signal.aborted) return;
    const ocrExtraction = ocrResponse.extraction;
    page.rawText = ocrExtraction.pages?.[0]?.text || ocrExtraction.originalText || '';
    page.result = ocrExtraction;
    persistAndRenderCaptures();

    if (entry.verifyWithAi) {
      await runAiCorrection(capture, page, entry, signal);
      if (!isCurrentPageEntry(page, entry) || signal.aborted) return;
    }

    page.status = 'completed';
    page.elapsedMs = Date.now() - page.startedAt;
    page.error = '';
    page.errorCode = '';
    page.recovery = null;
    applyRetailerCandidate(
      page.result?.final?.retailerName
      || page.result?.ai?.interpretation?.retailerName
      || page.result?.deterministic?.retailerName,
    );
  } catch (error) {
    if (!isCurrentPageEntry(page, entry)) return;
    page.elapsedMs = Date.now() - page.startedAt;
    if (error.name === 'AbortError') {
      if (page.status === 'ai' && (page.rawText || page.result)) {
        page.status = 'completed';
        page.aiStatus = 'idle';
      } else {
        page.status = 'cancelled';
      }
      page.error = '';
      page.errorCode = '';
      page.recovery = null;
    } else {
      page.status = 'error';
      page.errorCode = typeof error.code === 'string' ? error.code : '';
      page.recovery = buildReceiptAiRecovery(error, {
        mimeType: capture.mimeType,
        hasOcrDraft: Boolean(page.rawText || page.result),
      });
      page.error = page.recovery.message;
    }
  } finally {
    if (isCurrentPageEntry(page, entry)) persistAndRenderCaptures();
  }
}

export function isCurrentPageEntry(page, entry) {
  return entry.token === state.runToken && page.version === entry.version;
}

export function cancelCaptureProcessing(index) {
  const capture = state.captures[index];
  if (!capture) return;
  const key = captureKey(capture);
  const page = state.pageStates.get(key);
  if (!page) return;
  const preserveOcr = page.status === 'ai' && Boolean(page.rawText || page.result);
  page.version += 1;
  state.pageQueue = state.pageQueue.filter(entry => entry.key !== key);
  for (const task of state.activePageTasks.values()) {
    if (task.key === key && task.token === state.runToken) task.controller.abort();
  }
  page.status = preserveOcr ? 'completed' : 'cancelled';
  page.elapsedMs = page.startedAt ? Date.now() - page.startedAt : page.elapsedMs;
  page.error = '';
  page.errorCode = '';
  page.recovery = null;
  if (preserveOcr) {
    page.aiStatus = 'idle';
    page.aiError = '';
    page.aiErrorCode = '';
    page.aiRecovery = null;
  }
  persistAndRenderCaptures();
  $('#receipt-state').textContent = preserveOcr
    ? `Corrección con IA cancelada en la imagen ${index + 1}. El OCR local se conserva para revisión.`
    : `Imagen ${index + 1} cancelada. Las demás continúan y el OCR parcial se conserva.`;
  pumpPageQueue();
}

export function retryCaptureProcessing(index) {
  const capture = state.captures[index];
  if (!capture) return;
  const key = captureKey(capture);
  const previous = state.pageStates.get(key) ?? createPageState();
  for (const task of state.activePageTasks.values()) {
    if (task.key === key && task.token === state.runToken) task.controller.abort();
  }
  state.pageQueue = state.pageQueue.filter(entry => entry.key !== key);
  clearCombinedReview();
  const page = createPageState(previous);
  state.pageStates.set(key, page);
  state.verifyWithAi = state.aiConfigured && $('#verify-receipt-ai').checked;
  state.processing = true;
  if (!state.progressTimer) startReceiptProgress();
  enqueueCapture(capture, state.verifyWithAi);
  persistAndRenderCaptures();
  $('#receipt-state').textContent = `Reintentando la imagen ${index + 1}. Primero se ejecutará OCR local${state.verifyWithAi ? ' y después la corrección opcional con IA' : ''}.`;
  pumpPageQueue();
}

export async function retryAiCorrection(index) {
  const capture = state.captures[index];
  if (!capture || !state.aiConfigured) return;
  const key = captureKey(capture);
  const page = state.pageStates.get(key);
  if (!page) return;

  const durableBackgroundFailure = page.status === 'error'
    && page.errorCode.startsWith('AI_')
    && Boolean(state.activeJobId)
    && state.failedBackgroundJobId === state.activeJobId;
  if (durableBackgroundFailure) {
    await retryFailedReceiptExtractionJob();
    return;
  }

  const hasAiFailure = page.aiStatus === 'error'
    || (page.status === 'error' && page.errorCode.startsWith('AI_'));
  const hasReusableInput = Boolean(page.rawText || page.result)
    || capture.mimeType === 'application/pdf';
  if (!hasAiFailure || !hasReusableInput) return;

  for (const task of state.activePageTasks.values()) {
    if (task.key === key && task.token === state.runToken) task.controller.abort();
  }
  state.pageQueue = state.pageQueue.filter(entry => entry.key !== key);
  clearCombinedReview({ keepPanel: true });
  page.version += 1;
  page.status = 'ready';
  page.error = '';
  page.errorCode = '';
  page.recovery = null;
  page.aiStatus = 'idle';
  page.aiError = '';
  page.aiErrorCode = '';
  page.aiRecovery = null;
  state.processing = true;
  state.selectedReviewCaptureKey = key;
  if (!state.progressTimer) startReceiptProgress();
  enqueueCapture(capture, true, state.runToken, 'ai-only');
  persistAndRenderCaptures();
  renderReviewReference();
  $('#receipt-state').textContent = `Volviendo a analizar con IA la imagen ${index + 1}; se reutiliza el OCR ya conservado.`;
  pumpPageQueue();
}

export function useManualReview(index) {
  const capture = state.captures[index];
  if (!capture) return;
  const page = state.pageStates.get(captureKey(capture));
  if (!page) return;

  if (page.status === 'completed' && page.aiStatus === 'error') {
    showReviewPanelForCapture(index);
    $('#receipt-state').textContent = state.extraction
      ? `Revisión manual abierta para la imagen ${index + 1}. Corrige las filas manteniendo la captura a la vista.`
      : `Imagen ${index + 1} seleccionada para revisión manual. El editor conjunto aparecerá cuando terminen las demás capturas.`;
    return;
  }

  if (page.status !== 'error' || !page.recovery?.allowManualReview) return;
  page.version += 1;
  page.status = 'manual';
  page.error = '';
  page.errorCode = '';
  page.recovery = null;
  state.manualReviewRequired = true;
  state.processing = true;
  state.selectedReviewCaptureKey = captureKey(capture);
  if (!state.progressTimer) startReceiptProgress();
  persistAndRenderCaptures();
  showReviewPanelForCapture(index);
  $('#receipt-state').textContent = `Imagen ${index + 1} enviada a revisión manual. El OCR es sólo un borrador: valida todas las líneas y el total antes de confirmar.`;
  pumpPageQueue();
}

export function cancelReceiptExtraction() {
  clearReceiptExtractionJob({ cancel: true });
  abortPageWork({ markCancelled: true });
  state.processing = false;
  state.finalizing = false;
  persistAndRenderCaptures();
  $('#receipt-state').textContent = 'Análisis cancelado. Las capturas, los OCR parciales y las páginas completadas se conservan.';
}

export async function finishCurrentRunWhenIdle() {
  if (!state.processing || state.finalizing) return;
  const currentActive = [...state.activePageTasks.values()]
    .some(task => task.token === state.runToken);
  const currentPending = state.pageQueue.some(entry => entry.token === state.runToken);
  if (currentActive || currentPending) return;

  const pages = state.captures.map(capture => state.pageStates.get(captureKey(capture)));
  if (pages.every(page => page && REVIEWABLE_PAGE_STATUSES.has(page.status))) {
    await assembleCompletedPages(state.runToken);
    return;
  }

  state.processing = false;
  stopReceiptProgress();
  updateGlobalProgress();
  const failed = pages.filter(page => page?.status === 'error').length;
  const cancelled = pages.filter(page => page?.status === 'cancelled').length;
  $('#receipt-state').textContent = `${failed} imágenes con error y ${cancelled} canceladas. Reintenta, revisa manualmente o retira esas imágenes para preparar la revisión.`;
}

export async function assembleCompletedPages(token) {
  if (token !== state.runToken || state.finalizing) return;
  state.finalizing = true;
  updateGlobalProgress();
  const controller = new AbortController();
  state.assemblyController = controller;
  try {
    const requests = state.captures.map(capture => {
      const page = state.pageStates.get(captureKey(capture));
      return captureRequest(capture, canonicalPageText(page));
    });
    const result = await requestExtraction(requests, false, controller.signal);
    if (token !== state.runToken || controller.signal.aborted) return;
    const rawOriginalText = state.captures
      .map(capture => state.pageStates.get(captureKey(capture))?.rawText || '')
      .filter(Boolean)
      .join('\n')
      .trim();
    applyExtraction(result.extraction, rawOriginalText || result.extraction.originalText || '');
    const articleCount = result.extraction.final.articleCount;
    const hasManualPages = state.captures.some(capture => (
      state.pageStates.get(captureKey(capture))?.status === 'manual'
    ));
    if (hasManualPages) {
      $('#receipt-state').textContent = 'Revisión manual preparada. Corrige cantidades e importes y pulsa “Validar líneas” antes de confirmar.';
    } else {
      $('#receipt-state').textContent = articleCount === undefined
        ? 'Todas las imágenes están combinadas. Revisa las líneas, cantidades y total antes de confirmar.'
        : `Todas las imágenes están combinadas. El ticket indica ${articleCount} artículos; revisa las líneas y el total.`;
    }
  } catch (error) {
    if (error.name !== 'AbortError' && token === state.runToken) {
      $('#receipt-state').textContent = `${error.message}. Las páginas completadas se conservan; vuelve a procesar para combinar.`;
    }
  } finally {
    if (token === state.runToken) {
      state.processing = false;
      state.finalizing = false;
      state.assemblyController = null;
      stopReceiptProgress({ hide: true });
      updateGlobalProgress();
      persistAndRenderCaptures();
    }
  }
}

export function canonicalPageText(page) {
  const final = page?.result?.final;
  if (!final) return page?.rawText || 'Sin texto legible';
  const lines = [];
  if (final.retailerName) lines.push(final.retailerName);
  for (const item of final.items || []) {
    const description = String(item.description || '').replace(/[;|\r\n]+/gu, ' ').trim();
    const fields = [description, item.quantity, item.unitPriceMinor, item.lineTotalMinor];
    if (item.taxCategory) fields.push(item.taxCategory);
    if (item.discountMinor !== undefined) fields.push(item.discountMinor);
    lines.push(fields.join(';'));
  }
  if (final.declaredTotalMinor !== undefined) {
    lines.push(`TOTAL ${minorToEuroInput(final.declaredTotalMinor)}`);
  }
  if (final.articleCount !== undefined) {
    lines.push(`NUM. TOTAL ART. VENDIDOS = ${final.articleCount}`);
  }
  if (lines.length === 0) return page.result.ai?.interpretation?.correctedText || page.rawText || 'Sin texto legible';
  return lines.join('\n');
}
