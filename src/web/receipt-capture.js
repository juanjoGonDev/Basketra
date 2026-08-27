import { api } from './api.js';
import { saveCaptures } from './state.js';
import { captureItem } from './ui.js';
import {
  ACTIVE_PAGE_STATUSES,
  PAGE_LABELS,
  $,
  captureKey,
  createPageState,
  ensurePageStates,
  metadata,
  openDialog,
  state,
  toast,
} from './receipt-state.js';
import {
  clearReceiptExtractionJob,
  currentElapsed,
  formatElapsed,
  rebuildCombinedReview,
  startAutomaticCaptureProcessing,
  updateGlobalProgress,
} from './receipt-lifecycle.js';
import {
  cancelCaptureProcessing,
  retryAiCorrection,
  retryCaptureProcessing,
  useManualReview,
} from './receipt-processing.js';
export function persistAndRenderCaptures() {
  ensurePageStates();
  saveCaptures(state.captures);
  const list = $('#capture-list');
  list.innerHTML = state.captures
    .map((capture, index) => captureItem(capture, index, state.captures.length))
    .join('');

  state.captures.forEach((capture, index) => {
    const card = list.children[index];
    if (!(card instanceof HTMLElement)) return;
    card.dataset.captureKey = captureKey(capture);
    renderCaptureProgress(card, capture, index);
  });

  list.querySelectorAll('img[data-capture-preview-image]').forEach(image => {
    image.addEventListener('error', () => {
      image.hidden = true;
      if (image.nextElementSibling) image.nextElementSibling.hidden = false;
    }, { once: true });
  });
  updateGlobalProgress();
}

function pageDiagnostic(page) {
  if (page.aiStatus === 'error' && typeof page.aiRecovery?.diagnostic === 'string') {
    return page.aiRecovery.diagnostic;
  }
  if (page.status === 'error' && typeof page.recovery?.diagnostic === 'string') {
    return page.recovery.diagnostic;
  }
  return '';
}

export function renderCaptureProgress(card, capture, index) {
  const key = captureKey(capture);
  const page = state.pageStates.get(key) ?? createPageState();
  const active = ACTIVE_PAGE_STATUSES.has(page.status);
  const details = document.createElement('details');
  details.className = 'capture-card__details';
  details.dataset.capturePageProgress = key;
  details.open = state.expandedCaptureKey === key;

  const summary = document.createElement('summary');
  summary.className = 'capture-card__summary';
  const summaryCopy = document.createElement('span');
  summaryCopy.className = 'capture-card__summary-copy';
  const position = document.createElement('strong');
  position.textContent = `Imagen ${index + 1} de ${state.captures.length}`;
  const stage = document.createElement('small');
  stage.textContent = pageStageDescription(page);
  summaryCopy.append(position, stage);
  const status = document.createElement('span');
  status.className = `status-pill ${pageStatusClass(page)}`;
  status.textContent = page.status === 'completed' && page.aiStatus === 'error'
    ? 'OCR listo'
    : (PAGE_LABELS[page.status] || PAGE_LABELS.pending);
  summary.append(summaryCopy, status);

  const section = document.createElement('section');
  section.className = 'capture-card__progress';
  section.setAttribute('aria-live', 'polite');

  const meta = document.createElement('div');
  meta.className = 'capture-card__progress-meta';
  const metaStage = document.createElement('span');
  metaStage.textContent = pageStageDescription(page);
  const elapsed = document.createElement('span');
  elapsed.dataset.captureElapsed = key;
  elapsed.textContent = formatElapsed(currentElapsed(page));
  meta.append(metaStage, elapsed);

  const track = document.createElement('div');
  track.className = 'capture-card__stage-track';
  track.setAttribute('role', 'progressbar');
  track.setAttribute('aria-label', `Etapa de procesamiento de la imagen ${index + 1}`);
  track.setAttribute('aria-valuemin', '0');
  track.setAttribute('aria-valuemax', '3');
  track.setAttribute('aria-valuenow', String(pageStageValue(page.status)));
  track.style.setProperty('--capture-stage-progress', `${pageStageValue(page.status) / 3 * 100}%`);
  section.append(meta, track);

  const partialText = pagePartialText(page);
  if (partialText) {
    const partial = document.createElement('p');
    partial.className = page.status === 'error'
      ? 'capture-card__error'
      : (page.aiStatus === 'error' ? 'capture-card__warning' : 'capture-card__partial');
    partial.textContent = partialText;
    section.append(partial);
  }

  const showPrimaryRecovery = active || page.status === 'error' || page.status === 'cancelled';
  const showAiRecovery = page.status === 'completed' && page.aiStatus === 'error';
  const showPrimaryAiRecovery = page.status === 'error'
    && page.errorCode.startsWith('AI_')
    && state.aiConfigured;
  if (showPrimaryRecovery || showAiRecovery) {
    const actions = document.createElement('div');
    actions.className = 'capture-card__page-actions';

    if (showPrimaryRecovery) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'button secondary';
      button.dataset.captureIndex = String(index);
      if (active) {
        button.dataset.captureAction = 'cancel-processing';
        button.textContent = page.status === 'ai' && (page.rawText || page.result)
          ? 'Cancelar corrección con IA'
          : 'Cancelar esta imagen';
      } else if (showPrimaryAiRecovery) {
        button.dataset.captureAction = 'retry-ai';
        button.textContent = 'Volver a analizar con IA';
      } else {
        button.dataset.captureAction = 'retry-processing';
        button.textContent = page.recovery?.retryLabel || 'Reintentar imagen';
      }
      actions.append(button);
    }

    if ((page.status === 'error' && page.recovery?.allowManualReview) || showAiRecovery) {
      const manualButton = document.createElement('button');
      manualButton.type = 'button';
      manualButton.className = 'button secondary';
      manualButton.dataset.captureIndex = String(index);
      manualButton.dataset.captureAction = 'manual-review';
      manualButton.textContent = 'Revisar manualmente';
      actions.append(manualButton);
    }

    if (showAiRecovery) {
      const aiButton = document.createElement('button');
      aiButton.type = 'button';
      aiButton.className = 'button secondary';
      aiButton.dataset.captureIndex = String(index);
      aiButton.dataset.captureAction = 'retry-ai';
      aiButton.textContent = 'Volver a analizar con IA';
      actions.append(aiButton);
    }

    if (pageDiagnostic(page)) {
      const diagnosticButton = document.createElement('button');
      diagnosticButton.type = 'button';
      diagnosticButton.className = 'button secondary';
      diagnosticButton.dataset.captureIndex = String(index);
      diagnosticButton.dataset.captureAction = 'copy-ai-diagnostic';
      diagnosticButton.textContent = 'Copiar diagnóstico';
      actions.append(diagnosticButton);
    }

    section.append(actions);
  }

  details.append(summary, section);
  details.addEventListener('toggle', () => {
    if (details.open) state.expandedCaptureKey = key;
    else if (state.expandedCaptureKey === key) state.expandedCaptureKey = '';
  });
  card.append(details);
  card.querySelectorAll('[data-capture-action="up"], [data-capture-action="down"], [data-capture-action="delete"]')
    .forEach(button => {
      if (active) button.disabled = true;
    });
}

export function pageStatusClass(page) {
  if (page.status === 'completed' && page.aiStatus === 'error') return 'warning';
  if (page.status === 'completed') return 'success';
  if (page.status === 'manual') return 'warning';
  if (page.status === 'error') return 'error';
  if (page.status === 'cancelled') return 'warning';
  return '';
}

export function pageStageValue(status) {
  if (status === 'ready' || status === 'preparing' || status === 'pending' || status === 'cancelled' || status === 'error') return 0;
  if (status === 'ocr') return 1;
  if (status === 'ai') return 2;
  if (status === 'completed' || status === 'manual') return 3;
  return 0;
}

export function pageStageDescription(page) {
  if (page.status === 'ready') return 'Lista para procesar';
  if (page.status === 'pending') return 'En espera de un hueco del pool';
  if (page.status === 'preparing') return 'Preparando la captura almacenada';
  if (page.status === 'ocr') return 'Reconociendo el texto localmente';
  if (page.status === 'ai') return 'Corrigiendo el OCR con IA';
  if (page.status === 'completed' && page.aiStatus === 'error') return 'OCR listo · IA sin corregir';
  if (page.status === 'completed') return page.aiStatus === 'completed' ? 'OCR corregido con IA' : 'OCR listo para revisar';
  if (page.status === 'manual') return 'OCR conservado; cantidades e importes requieren revisión manual';
  if (page.status === 'cancelled') return 'Esta imagen no se incluirá hasta reintentar';
  if (page.status === 'error') return 'La captura y el OCR parcial se conservan';
  return '';
}

export function pagePartialText(page) {
  if (page.status === 'error') return page.error || 'No se pudo procesar esta imagen.';
  if (page.aiStatus === 'error') return page.aiError || 'La IA no pudo corregir esta imagen; el OCR local sigue disponible.';
  const itemCount = page.result?.final?.items?.length;
  if (page.status === 'manual' && Number.isSafeInteger(itemCount)) {
    return `${itemCount} ${itemCount === 1 ? 'línea OCR pendiente' : 'líneas OCR pendientes'} de revisión manual`;
  }
  if (Number.isSafeInteger(itemCount)) {
    return `${itemCount} ${itemCount === 1 ? 'línea estructurada' : 'líneas estructuradas'}`;
  }
  if (page.rawText) {
    const lines = page.rawText.split(/\r?\n/u).filter(line => line.trim()).length;
    return `${lines} ${lines === 1 ? 'línea OCR conservada' : 'líneas OCR conservadas'}`;
  }
  if (page.status === 'manual') return 'Entrada manual pendiente; la captura original se conserva';
  return '';
}

export function validateFile(file) {
  if (!metadata.files.mimeTypes.includes(file.type)) {
    throw new Error(`Tipo de archivo no admitido: ${file.name || 'archivo'}`);
  }
  if (!Number.isSafeInteger(file.size) || file.size <= 0) {
    throw new Error(`El archivo está vacío: ${file.name || 'archivo'}`);
  }
  if (file.size > metadata.files.maxBytes) {
    throw new Error(`El archivo supera el límite de ${formatMegabytes(metadata.files.maxBytes)} MB`);
  }
}

export function formatMegabytes(bytes) {
  return Math.max(1, Math.floor(bytes / (1024 * 1024)));
}

export function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error || new Error('No se pudo leer el archivo'));
    reader.onload = () => resolve(String(reader.result).split(',')[1]);
    reader.readAsDataURL(file);
  });
}

export async function uploadFiles(fileList) {
  const files = [...fileList];
  if (files.length === 0) return;
  const addedCaptures = [];
  const hadBackgroundJob = Boolean(state.activeJobId);
  try {
    files.forEach(validateFile);
    for (const [index, file] of files.entries()) {
      $('#upload-state').textContent = `Subiendo ${index + 1} de ${files.length}: ${file.name || 'captura'}…`;
      const base64 = await fileToBase64(file);
      const result = await api('/api/v1/files', {
        method: 'POST',
        body: JSON.stringify({ base64, mimeType: file.type, originalName: file.name || 'captura' }),
      });
      const capture = {
        name: file.name || `captura-${Date.now()}`,
        mimeType: result.file.mimeType,
        bytes: result.file.bytes,
        storageKey: result.file.storageKey,
        contentHash: result.file.hash,
      };
      state.captures.push(capture);
      addedCaptures.push(capture);
    }

    if (hadBackgroundJob) clearReceiptExtractionJob({ cancel: true });
    ensurePageStates();
    persistAndRenderCaptures();
    $('#upload-state').textContent = 'Capturas guardadas. El OCR ha empezado automáticamente.';
    toast('Capturas guardadas · OCR iniciado');
    startAutomaticCaptureProcessing(hadBackgroundJob ? state.captures : addedCaptures, {
      resetAll: hadBackgroundJob,
    });
  } catch (error) {
    $('#upload-state').textContent = error.message;
    toast(error.message);
  }
}

export function showPreview(index) {
  const capture = state.captures[index];
  if (!capture || !capture.mimeType.startsWith('image/')) return;
  $('#capture-preview-name').textContent = capture.name;
  $('#capture-preview-image').src = `/api/v1/files/${encodeURIComponent(capture.storageKey)}`;
  $('#capture-preview-image').alt = `Vista ampliada de ${capture.name}`;
  openDialog($('#capture-preview-dialog'));
}

export function moveCapture(index, direction) {
  if (state.processing || state.finalizing) return;
  const target = index + direction;
  if (!state.captures[index] || !state.captures[target]) return;
  [state.captures[index], state.captures[target]] = [state.captures[target], state.captures[index]];
  saveCaptures(state.captures);
  rebuildCombinedReview();
}

export function deleteCapture(index) {
  if (state.processing || state.finalizing || !state.captures[index]) return;
  const [removed] = state.captures.splice(index, 1);
  if (removed) state.pageStates.delete(captureKey(removed));
  saveCaptures(state.captures);
  rebuildCombinedReview();
  persistAndRenderCaptures();
  $('#upload-state').textContent = 'Captura retirada del borrador; la evidencia original se conserva';
}

async function copyAiDiagnostic(index) {
  const capture = state.captures[index];
  if (!capture) return;
  const page = state.pageStates.get(captureKey(capture));
  const diagnostic = page ? pageDiagnostic(page) : '';
  if (!diagnostic || typeof navigator.clipboard?.writeText !== 'function') {
    toast('No se pudo copiar el diagnóstico');
    return;
  }
  try {
    await navigator.clipboard.writeText(diagnostic);
    toast('Diagnóstico copiado');
  } catch {
    toast('No se pudo copiar el diagnóstico');
  }
}

export function handleCaptureAction(event) {
  const button = event.target.closest('[data-capture-action]');
  if (!button) return;
  const index = Number(button.dataset.captureIndex);
  const action = button.dataset.captureAction;
  if (action === 'preview') showPreview(index);
  if (action === 'up') moveCapture(index, -1);
  if (action === 'down') moveCapture(index, 1);
  if (action === 'delete') deleteCapture(index);
  if (action === 'cancel-processing') cancelCaptureProcessing(index);
  if (action === 'retry-processing') retryCaptureProcessing(index);
  if (action === 'retry-ai') retryAiCorrection(index);
  if (action === 'manual-review') useManualReview(index);
  if (action === 'copy-ai-diagnostic') void copyAiDiagnostic(index);
}
