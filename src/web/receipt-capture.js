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

const MAX_PROGRESSIVE_OCR_ITEMS = 5;
const MAX_PROGRESSIVE_OCR_TEXT_CHARS = 4000;

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
  if ((page.status === 'error' || page.status === 'manual') && typeof page.recovery?.diagnostic === 'string') {
    return page.recovery.diagnostic;
  }
  return '';
}

function appendProgressiveOcrEvidence(section, page) {
  const evidence = page.ocrEvidence;
  if (!evidence || typeof evidence.text !== 'string' || !evidence.text) return;

  const items = Array.isArray(evidence.deterministic?.items)
    ? evidence.deterministic.items
    : [];
  const preview = document.createElement('details');
  preview.className = 'capture-card__ocr-preview';
  const summary = document.createElement('summary');
  summary.textContent = items.length === 0
    ? 'OCR disponible mientras continúa la IA'
    : `${items.length} ${items.length === 1 ? 'producto detectado' : 'productos detectados'} por OCR`;
  preview.append(summary);

  if (items.length > 0) {
    const list = document.createElement('ul');
    for (const item of items.slice(0, MAX_PROGRESSIVE_OCR_ITEMS)) {
      const row = document.createElement('li');
      row.textContent = typeof item?.description === 'string' && item.description
        ? item.description
        : 'Producto sin descripción legible';
      list.append(row);
    }
    if (items.length > MAX_PROGRESSIVE_OCR_ITEMS) {
      const remaining = document.createElement('li');
      remaining.textContent = `+ ${items.length - MAX_PROGRESSIVE_OCR_ITEMS} más`;
      list.append(remaining);
    }
    preview.append(list);
  }

  const text = document.createElement('pre');
  text.className = 'capture-card__ocr-text';
  text.textContent = evidence.text.length > MAX_PROGRESSIVE_OCR_TEXT_CHARS
    ? `${evidence.text.slice(0, MAX_PROGRESSIVE_OCR_TEXT_CHARS)}\n…`
    : evidence.text;
  preview.append(text);
  section.append(preview);
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
  appendProgressiveOcrEvidence(section, page);

  const showPrimaryAiRecovery = (page.status === 'error' || page.status === 'manual')
    && page.errorCode.startsWith('AI_')
    && state.aiConfigured;
  const showPrimaryRecovery = active
    || page.status === 'error'
    || page.status === 'cancelled'
    || showPrimaryAiRecovery;
  const showAiRecovery = page.status === 'completed' && page.aiStatus === 'error';
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
  const itemCount = page.result?.final?.items?.length;
  const ocrItemCount = page.ocrEvidence?.deterministic?.items?.length;
  const hasStructuredItems = Number.isSafeInteger(itemCount) && itemCount > 0;
  const hasOcrEvidence = (Number.isSafeInteger(ocrItemCount) && ocrItemCount > 0) || Boolean(page.rawText);
  if (page.status === 'manual' && !hasStructuredItems && !hasOcrEvidence) {
    return 'Entrada manual pendiente; la captura original se conserva';
  }
  if (page.aiStatus === 'error') return page.aiError || 'La IA no pudo corregir esta imagen; el OCR local sigue disponible.';
  if (page.status === 'manual' && Number.isSafeInteger(itemCount)) {
    return `${itemCount} ${itemCount === 1 ? 'línea OCR pendiente' : 'líneas OCR pendientes'} de revisión manual`;
  }
  if (Number.isSafeInteger(itemCount)) {
    return `${itemCount} ${itemCount === 1 ? 'línea estructurada' : 'líneas estructuradas'}`;
  }
  if (Number.isSafeInteger(ocrItemCount)) {
    return `${ocrItemCount} ${ocrItemCount === 1 ? 'producto OCR detectado' : 'productos OCR detectados'} · ${page.status === 'ai' ? 'IA verificando' : 'OCR conservado'}`;
  }
  if (page.rawText) {
    const lines = page.rawText.split(/\r?\n/u).filter(line => line.trim()).length;
    return `${lines} ${lines === 1 ? 'línea OCR conservada' : 'líneas OCR conservadas'}`;
  }
  if (page.status === 'manual') return 'Entrada manual pendiente; la captura original se conserva';
  return '';
}

export function validateFile(file, runtimeCapabilities) {
  if (!metadata.files.mimeTypes.includes(file.type)) {
    throw new Error(`Tipo de archivo no admitido: ${file.name || 'archivo'}`);
  }
  if (!Number.isSafeInteger(file.size) || file.size <= 0) {
    throw new Error(`El archivo está vacío: ${file.name || 'archivo'}`);
  }
  if (runtimeCapabilities === undefined) return;

  const maxBytes = file.type === 'application/pdf'
    ? runtimeCapabilities?.attachments?.maxFileBytes
    : runtimeCapabilities?.attachments?.maxImageBytes;
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) return;
  if (file.size > maxBytes) {
    throw new Error(
      `El archivo ${file.name || 'archivo'} ocupa ${formatMegabytes(file.size)} MB y supera el límite de ${formatMegabytes(maxBytes)} MB`,
    );
  }
}

export function formatMegabytes(bytes) {
  const megabytes = bytes / (1024 * 1024);
  return new Intl.NumberFormat('es-ES', {
    maximumFractionDigits: 1,
    minimumFractionDigits: Number.isInteger(megabytes) ? 0 : 1,
  }).format(megabytes);
}

function ensureReceiptAiLimitHelp() {
  let help = $('#receipt-ai-limit-help');
  if (help) return help;
  const anchor = $('#receipt-ai-help');
  if (!anchor) return null;
  help = document.createElement('p');
  help.id = 'receipt-ai-limit-help';
  help.className = 'field-help';
  help.setAttribute('role', 'status');
  anchor.insertAdjacentElement('afterend', help);
  return help;
}

function renderReceiptAiLimits(runtimeCapabilities) {
  const maxImageBytes = runtimeCapabilities?.attachments?.maxImageBytes;
  const maxFileBytes = runtimeCapabilities?.attachments?.maxFileBytes;
  if (!Number.isSafeInteger(maxImageBytes) || maxImageBytes <= 0 || !Number.isSafeInteger(maxFileBytes) || maxFileBytes <= 0) {
    throw new Error('WebAPI no ha devuelto límites de adjuntos válidos');
  }
  const help = ensureReceiptAiLimitHelp();
  if (help) help.textContent = `Límites actuales de WebAPI: imágenes ${formatMegabytes(maxImageBytes)} MB · PDF/archivos ${formatMegabytes(maxFileBytes)} MB.`;
  return runtimeCapabilities;
}

function renderReceiptAiLimitsUnavailable() {
  const help = ensureReceiptAiLimitHelp();
  if (help) help.textContent = 'No se pudieron consultar los límites actuales de WebAPI. El OCR local seguirá disponible y no se usará un límite funcional de Basketra como sustituto.';
}

async function readReceiptAiRuntimeCapabilities() {
  const runtimeCapabilities = await api('/api/v1/ai/runtime-capabilities', { cache: 'no-store' });
  return renderReceiptAiLimits(runtimeCapabilities);
}

export async function refreshReceiptAiLimitHelp() {
  if (!state.aiConfigured) return;
  try {
    await readReceiptAiRuntimeCapabilities();
  } catch {
    renderReceiptAiLimitsUnavailable();
  }
}

export function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error || new Error('No se pudo leer el archivo'));
    reader.onload = () => resolve(String(reader.result).split(',')[1]);
    reader.readAsDataURL(file);
  });
}

async function readAiSizeWarning(files) {
  try {
    const runtimeCapabilities = await readReceiptAiRuntimeCapabilities();
    for (const file of files) {
      try {
        validateFile(file, runtimeCapabilities);
      } catch (error) {
        return error instanceof Error ? error.message : 'La captura supera el límite actual de WebAPI';
      }
    }
  } catch {
    renderReceiptAiLimitsUnavailable();
    return 'No se pudieron consultar los límites actuales de WebAPI; el OCR local continúa y la IA validará el límite antes de enviar.';
  }
  return '';
}

export async function uploadFiles(fileList) {
  const files = [...fileList];
  if (files.length === 0) return;
  const addedCaptures = [];
  const hadBackgroundJob = Boolean(state.activeJobId);
  try {
    files.forEach(file => validateFile(file));
    const aiSizeWarning = state.aiConfigured && $('#verify-receipt-ai')?.checked
      ? await readAiSizeWarning(files)
      : '';
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
    $('#upload-state').textContent = aiSizeWarning
      ? `Capturas guardadas. OCR iniciado. ${aiSizeWarning}`
      : 'Capturas guardadas. El OCR ha empezado automáticamente.';
    toast(aiSizeWarning ? `Capturas guardadas · ${aiSizeWarning}` : 'Capturas guardadas · OCR iniciado');
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

function invalidateDurableJobForCaptureMutation() {
  if (!state.activeJobId) return;
  clearReceiptExtractionJob({ cancel: true });
}

export function moveCapture(index, direction) {
  if (state.processing || state.finalizing) return;
  const target = index + direction;
  if (!state.captures[index] || !state.captures[target]) return;
  invalidateDurableJobForCaptureMutation();
  [state.captures[index], state.captures[target]] = [state.captures[target], state.captures[index]];
  saveCaptures(state.captures);
  rebuildCombinedReview();
}

export function deleteCapture(index) {
  if (state.processing || state.finalizing || !state.captures[index]) return;
  invalidateDurableJobForCaptureMutation();
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
