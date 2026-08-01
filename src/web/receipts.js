import { api, setBusy } from './api.js';
import { loadCaptures, saveCaptures } from './state.js';
import { captureItem, euroInputToMinor, minorToEuroInput, receiptReview } from './ui.js';

const PAGE_CONCURRENCY = 2;
const ACTIVE_PAGE_STATUSES = new Set(['preparing', 'ocr', 'ai']);
const PAGE_LABELS = {
  pending: 'Pendiente',
  preparing: 'Preparando imagen',
  ocr: 'OCR local',
  ai: 'Verificando con IA',
  completed: 'Completada',
  error: 'Error',
  cancelled: 'Cancelada',
};

const state = {
  captures: loadCaptures(),
  extraction: null,
  items: [],
  originalItems: [],
  originalText: '',
  aiConfigured: false,
  pageStates: new Map(),
  pageQueue: [],
  activePageTasks: new Map(),
  activePageCount: 0,
  nextTaskId: 1,
  runToken: 0,
  processing: false,
  finalizing: false,
  verifyWithAi: false,
  assemblyController: null,
  progressVisible: false,
  progressStartedAt: 0,
  progressTimer: null,
  retailerSuggestionController: null,
  retailerSuggestionTimer: null,
  retailerCandidates: new Map(),
  retailerManuallyEdited: false,
  settingRetailerValue: false,
};

let metadata;
let toast = () => {};

const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];

function openDialog(dialog) {
  if (typeof dialog.showModal === 'function') dialog.showModal();
  else dialog.setAttribute('open', '');
}

function closeDialog(dialog) {
  if (typeof dialog.close === 'function') dialog.close();
  else dialog.removeAttribute('open');
}

function captureKey(capture) {
  return capture.storageKey;
}

function captureByKey(key) {
  return state.captures.find(capture => captureKey(capture) === key);
}

function createPageState(previous = {}) {
  return {
    status: 'pending',
    version: Number(previous.version || 0) + 1,
    startedAt: 0,
    elapsedMs: 0,
    rawText: '',
    result: null,
    error: '',
    ...previous,
    status: 'pending',
    startedAt: 0,
    elapsedMs: 0,
    rawText: '',
    result: null,
    error: '',
  };
}

function ensurePageStates() {
  const currentKeys = new Set(state.captures.map(captureKey));
  for (const key of state.pageStates.keys()) {
    if (!currentKeys.has(key)) state.pageStates.delete(key);
  }
  for (const capture of state.captures) {
    const key = captureKey(capture);
    if (!state.pageStates.has(key)) state.pageStates.set(key, createPageState());
  }
}

function abortPageWork({ markCancelled = false } = {}) {
  state.runToken += 1;
  state.pageQueue = [];
  state.assemblyController?.abort();
  state.assemblyController = null;
  state.finalizing = false;
  for (const task of state.activePageTasks.values()) task.controller.abort();
  if (markCancelled) {
    for (const page of state.pageStates.values()) {
      if (page.status === 'pending' || ACTIVE_PAGE_STATUSES.has(page.status)) {
        page.version += 1;
        page.status = 'cancelled';
        page.elapsedMs = page.startedAt ? Date.now() - page.startedAt : page.elapsedMs;
        page.error = '';
      }
    }
  }
}

function invalidateExtraction() {
  abortPageWork();
  state.processing = false;
  state.extraction = null;
  state.items = [];
  state.originalItems = [];
  state.originalText = '';
  state.retailerCandidates.clear();
  ensurePageStates();
  for (const [key, page] of state.pageStates) state.pageStates.set(key, createPageState(page));
  $('#receipt-review').hidden = true;
  $('#confirm-receipt').hidden = true;
  $('#receipt-state').textContent = '';
  setBusy($('#extract-receipt'), false);
  stopReceiptProgress({ hide: true });
}

function persistAndRenderCaptures() {
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

  $('#extract-receipt').disabled = state.captures.length === 0 || state.processing || state.finalizing;
  list.querySelectorAll('img[data-capture-preview-image]').forEach(image => {
    image.addEventListener('error', () => {
      image.hidden = true;
      if (image.nextElementSibling) image.nextElementSibling.hidden = false;
    }, { once: true });
  });
  updateGlobalProgress();
}

function renderCaptureProgress(card, capture, index) {
  const page = state.pageStates.get(captureKey(capture)) ?? createPageState();
  const active = ACTIVE_PAGE_STATUSES.has(page.status);
  const section = document.createElement('section');
  section.className = 'capture-card__progress';
  section.dataset.capturePageProgress = captureKey(capture);
  section.setAttribute('aria-live', 'polite');

  const heading = document.createElement('div');
  heading.className = 'capture-card__progress-heading';
  const position = document.createElement('strong');
  position.textContent = `Imagen ${index + 1} de ${state.captures.length}`;
  const status = document.createElement('span');
  status.className = `status-pill ${pageStatusClass(page.status)}`;
  status.textContent = PAGE_LABELS[page.status] || PAGE_LABELS.pending;
  heading.append(position, status);

  const meta = document.createElement('div');
  meta.className = 'capture-card__progress-meta';
  const stage = document.createElement('span');
  stage.textContent = pageStageDescription(page);
  const elapsed = document.createElement('span');
  elapsed.dataset.captureElapsed = captureKey(capture);
  elapsed.textContent = formatElapsed(currentElapsed(page));
  meta.append(stage, elapsed);

  const track = document.createElement('div');
  track.className = 'capture-card__stage-track';
  track.setAttribute('role', 'progressbar');
  track.setAttribute('aria-label', `Etapa de procesamiento de la imagen ${index + 1}`);
  track.setAttribute('aria-valuemin', '0');
  track.setAttribute('aria-valuemax', '3');
  track.setAttribute('aria-valuenow', String(pageStageValue(page.status)));
  track.style.setProperty('--capture-stage-progress', `${pageStageValue(page.status) / 3 * 100}%`);

  section.append(heading, meta, track);

  const partialText = pagePartialText(page);
  if (partialText) {
    const partial = document.createElement('p');
    partial.className = page.status === 'error' ? 'capture-card__error' : 'capture-card__partial';
    partial.textContent = partialText;
    section.append(partial);
  }

  if (active || page.status === 'error' || page.status === 'cancelled') {
    const actions = document.createElement('div');
    actions.className = 'capture-card__page-actions';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = active ? 'button secondary' : 'button secondary';
    button.dataset.captureIndex = String(index);
    if (active) {
      button.dataset.captureAction = 'cancel-processing';
      button.textContent = 'Cancelar esta imagen';
    } else {
      button.dataset.captureAction = 'retry-processing';
      button.textContent = 'Reintentar imagen';
    }
    actions.append(button);
    section.append(actions);
  }

  card.append(section);
  card.querySelectorAll('[data-capture-action="up"], [data-capture-action="down"], [data-capture-action="delete"]')
    .forEach(button => {
      if (active) button.disabled = true;
    });
}

function pageStatusClass(status) {
  if (status === 'completed') return 'success';
  if (status === 'error') return 'error';
  if (status === 'cancelled') return 'warning';
  return '';
}

function pageStageValue(status) {
  if (status === 'preparing' || status === 'pending' || status === 'cancelled' || status === 'error') return 0;
  if (status === 'ocr') return 1;
  if (status === 'ai') return 2;
  if (status === 'completed') return 3;
  return 0;
}

function pageStageDescription(page) {
  if (page.status === 'pending') return 'En espera de un hueco del pool';
  if (page.status === 'preparing') return 'Preparando la captura almacenada';
  if (page.status === 'ocr') return 'Reconociendo el texto localmente';
  if (page.status === 'ai') return 'Corrigiendo el OCR y reconstruyendo líneas';
  if (page.status === 'completed') return 'OCR y revisión de esta imagen terminados';
  if (page.status === 'cancelled') return 'Esta imagen no se incluirá hasta reintentar';
  if (page.status === 'error') return 'La captura y el OCR parcial se conservan';
  return '';
}

function pagePartialText(page) {
  if (page.status === 'error') return page.error || 'No se pudo procesar esta imagen.';
  const itemCount = page.result?.final?.items?.length;
  if (Number.isSafeInteger(itemCount)) {
    return `${itemCount} ${itemCount === 1 ? 'línea estructurada' : 'líneas estructuradas'}`;
  }
  if (page.rawText) {
    const lines = page.rawText.split(/\r?\n/u).filter(line => line.trim()).length;
    return `${lines} ${lines === 1 ? 'línea OCR conservada' : 'líneas OCR conservadas'}`;
  }
  return '';
}

function validateFile(file) {
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

function formatMegabytes(bytes) {
  return Math.max(1, Math.floor(bytes / (1024 * 1024)));
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error || new Error('No se pudo leer el archivo'));
    reader.onload = () => resolve(String(reader.result).split(',')[1]);
    reader.readAsDataURL(file);
  });
}

async function uploadFiles(fileList) {
  const files = [...fileList];
  if (files.length === 0) return;
  try {
    files.forEach(validateFile);
    for (const [index, file] of files.entries()) {
      $('#upload-state').textContent = `Subiendo ${index + 1} de ${files.length}: ${file.name || 'captura'}…`;
      const base64 = await fileToBase64(file);
      const result = await api('/api/v1/files', {
        method: 'POST',
        body: JSON.stringify({ base64, mimeType: file.type, originalName: file.name || 'captura' }),
      });
      state.captures.push({
        name: file.name || `captura-${Date.now()}`,
        mimeType: result.file.mimeType,
        bytes: result.file.bytes,
        storageKey: result.file.storageKey,
        contentHash: result.file.hash,
      });
    }
    invalidateExtraction();
    persistAndRenderCaptures();
    $('#upload-state').textContent = 'Capturas guardadas y listas para revisar';
    toast('Capturas guardadas');
  } catch (error) {
    $('#upload-state').textContent = error.message;
    toast(error.message);
  }
}

function showPreview(index) {
  const capture = state.captures[index];
  if (!capture || !capture.mimeType.startsWith('image/')) return;
  $('#capture-preview-name').textContent = capture.name;
  $('#capture-preview-image').src = `/api/v1/files/${encodeURIComponent(capture.storageKey)}`;
  $('#capture-preview-image').alt = `Vista ampliada de ${capture.name}`;
  openDialog($('#capture-preview-dialog'));
}

function moveCapture(index, direction) {
  if (state.processing || state.finalizing) return;
  const target = index + direction;
  if (!state.captures[index] || !state.captures[target]) return;
  [state.captures[index], state.captures[target]] = [state.captures[target], state.captures[index]];
  invalidateExtraction();
  persistAndRenderCaptures();
}

function deleteCapture(index) {
  if (state.processing || state.finalizing || !state.captures[index]) return;
  const [removed] = state.captures.splice(index, 1);
  if (removed) state.pageStates.delete(captureKey(removed));
  invalidateExtraction();
  persistAndRenderCaptures();
  $('#upload-state').textContent = 'Captura retirada del borrador; la evidencia original se conserva';
}

function handleCaptureAction(event) {
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
}

function requestExtraction(captures, verifyWithAi, signal) {
  return api('/api/v1/receipts/extract', {
    method: 'POST',
    body: JSON.stringify({ captures, verifyWithAi }),
    signal,
  });
}

function captureRequest(capture, embeddedText) {
  return {
    storageKey: capture.storageKey,
    originalName: capture.name,
    ...(embeddedText ? { embeddedText } : {}),
  };
}

function renderReview(lines = [], total) {
  $('#receipt-review').hidden = false;
  $('#receipt-review').innerHTML = receiptReview(state.items, lines, total);
  $('#confirm-receipt').hidden = state.items.length === 0;
}

function applyExtraction(extraction, originalText = extraction.originalText || '') {
  state.extraction = extraction;
  state.items = extraction.final.items.map(item => ({ ...item }));
  state.originalItems = extraction.final.items.map(item => ({ ...item }));
  state.originalText = originalText;
  if (extraction.final.declaredTotalMinor !== undefined) {
    $('#receipt-total').value = minorToEuroInput(extraction.final.declaredTotalMinor);
  }
  applyRetailerCandidate(extraction.final.retailerName || extraction.ai?.interpretation?.retailerName);
  $('.manual-entry').open = true;
  renderReview(extraction.final.review.lines, extraction.final.review.total);
}

function addBlankLine() {
  try {
    if ($('.receipt-item')) state.items = readReceiptItems();
  } catch {
    // Preserve the last valid row model while the user is still editing another row.
  }
  state.items.push({
    description: '',
    quantity: 1,
    unitPriceMinor: 0,
    lineTotalMinor: 0,
    confidence: 0,
    userConfirmed: true,
  });
  renderReview();
  const input = $(`.receipt-item[data-item-index="${state.items.length - 1}"] [data-field="description"]`);
  input?.focus();
}

function restoreReceiptLine(index, item, original) {
  state.items.splice(Math.min(index, state.items.length), 0, item);
  if (original) state.originalItems.splice(Math.min(index, state.originalItems.length), 0, original);
  renderReview();
  $('#receipt-state').textContent = 'Línea restaurada; revisa el total antes de confirmar.';
  toast('Línea restaurada');
}

function deleteReceiptLine(index, { undoable = true } = {}) {
  try {
    state.items = readReceiptItems();
  } catch {
    // Removing a row must remain possible while another row has an incomplete euro value.
  }
  if (!state.items[index]) return;
  const [item] = state.items.splice(index, 1);
  const [original] = state.originalItems.splice(index, 1);
  renderReview();
  $('#receipt-state').textContent = 'Línea eliminada; revisa el total antes de confirmar.';
  if (!undoable) return;
  toast('Línea eliminada', {
    actionLabel: 'Deshacer',
    duration: 5200,
    onAction: () => restoreReceiptLine(index, item, original),
  });
}

function handleReceiptAction(event) {
  const button = event.target.closest('[data-receipt-action]');
  if (!button) return;
  const action = button.dataset.receiptAction;
  if (action === 'add-line') addBlankLine();
  if (action === 'delete') deleteReceiptLine(Number(button.dataset.receiptIndex));
  if (action === 'edit') {
    const row = button.closest('[data-swipe-row]')?.querySelector('.receipt-item');
    row?.querySelector('[data-field="description"]')?.focus();
  }
}

function formatElapsed(milliseconds) {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return minutes > 0
    ? `${minutes}:${String(remainingSeconds).padStart(2, '0')}`
    : `${remainingSeconds} s`;
}

function currentElapsed(page) {
  return ACTIVE_PAGE_STATUSES.has(page.status) && page.startedAt
    ? Date.now() - page.startedAt
    : page.elapsedMs;
}

function startReceiptProgress() {
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

function stopReceiptProgress({ hide = false } = {}) {
  clearInterval(state.progressTimer);
  state.progressTimer = null;
  if (hide) {
    state.progressVisible = false;
    const progress = $('#receipt-progress');
    if (progress) progress.hidden = true;
  }
}

function updateElapsedLabels() {
  for (const element of $$('[data-capture-elapsed]')) {
    const page = state.pageStates.get(element.dataset.captureElapsed);
    if (page) element.textContent = formatElapsed(currentElapsed(page));
  }
  if (state.progressVisible) {
    $('#receipt-progress-elapsed').textContent = formatElapsed(Date.now() - state.progressStartedAt);
  }
}

function updateGlobalProgress() {
  const progress = $('#receipt-progress');
  if (!progress || !state.progressVisible) return;
  progress.hidden = false;
  const pages = state.captures.map(capture => state.pageStates.get(captureKey(capture)) ?? createPageState());
  const total = pages.length;
  const completed = pages.filter(page => page.status === 'completed').length;
  const active = pages.filter(page => ACTIVE_PAGE_STATUSES.has(page.status)).length;
  const pending = pages.filter(page => page.status === 'pending').length;
  const failed = pages.filter(page => page.status === 'error').length;
  const cancelled = pages.filter(page => page.status === 'cancelled').length;
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

function resetPagesForProcessing() {
  abortPageWork();
  state.extraction = null;
  state.items = [];
  state.originalItems = [];
  state.originalText = '';
  state.retailerCandidates.clear();
  $('#receipt-review').hidden = true;
  $('#confirm-receipt').hidden = true;
  ensurePageStates();
  for (const [key, page] of state.pageStates) state.pageStates.set(key, createPageState(page));
}

function processReceipt() {
  if (state.captures.length === 0) {
    $('#receipt-state').textContent = 'Añade al menos una captura antes de procesar.';
    $('#receipt-camera').focus();
    return;
  }
  resetPagesForProcessing();
  state.verifyWithAi = state.aiConfigured && $('#verify-receipt-ai').checked;
  state.processing = true;
  setBusy($('#extract-receipt'), true);
  startReceiptProgress();
  $('#receipt-state').textContent = state.verifyWithAi
    ? 'Procesando hasta dos imágenes a la vez: OCR local y después verificación IA por página.'
    : 'Procesando hasta dos imágenes a la vez con OCR local.';
  const token = state.runToken;
  for (const capture of state.captures) enqueueCapture(capture, state.verifyWithAi, token);
  persistAndRenderCaptures();
  pumpPageQueue();
}

function enqueueCapture(capture, verifyWithAi, token = state.runToken) {
  const page = state.pageStates.get(captureKey(capture));
  if (!page) return;
  state.pageQueue.push({
    key: captureKey(capture),
    version: page.version,
    token,
    verifyWithAi,
  });
}

function pumpPageQueue() {
  while (state.activePageCount < PAGE_CONCURRENCY && state.pageQueue.length > 0) {
    const entry = state.pageQueue.shift();
    if (!entry || entry.token !== state.runToken) continue;
    const capture = captureByKey(entry.key);
    const page = state.pageStates.get(entry.key);
    if (!capture || !page || page.version !== entry.version || page.status !== 'pending') continue;
    if ([...state.activePageTasks.values()].some(task => task.key === entry.key)) {
      state.pageQueue.push(entry);
      break;
    }
    startPageTask(capture, entry);
  }
  void finishCurrentRunWhenIdle();
}

function startPageTask(capture, entry) {
  const controller = new AbortController();
  const taskId = state.nextTaskId;
  state.nextTaskId += 1;
  state.activePageCount += 1;
  state.activePageTasks.set(taskId, { key: entry.key, token: entry.token, controller });
  void processCapture(capture, entry, controller.signal)
    .finally(() => {
      state.activePageTasks.delete(taskId);
      state.activePageCount -= 1;
      pumpPageQueue();
      updateGlobalProgress();
    });
}

async function processCapture(capture, entry, signal) {
  const page = state.pageStates.get(entry.key);
  if (!page || !isCurrentPageEntry(page, entry)) return;
  page.status = 'preparing';
  page.startedAt = Date.now();
  page.elapsedMs = 0;
  page.error = '';
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
      page.status = 'ai';
      persistAndRenderCaptures();
      const aiResponse = await requestExtraction(
        [captureRequest(capture, page.rawText)],
        true,
        signal,
      );
      if (!isCurrentPageEntry(page, entry) || signal.aborted) return;
      page.result = aiResponse.extraction;
    }

    page.status = 'completed';
    page.elapsedMs = Date.now() - page.startedAt;
    page.error = '';
    applyRetailerCandidate(
      page.result?.final?.retailerName
      || page.result?.ai?.interpretation?.retailerName
      || page.result?.deterministic?.retailerName,
    );
  } catch (error) {
    if (!isCurrentPageEntry(page, entry)) return;
    page.elapsedMs = Date.now() - page.startedAt;
    if (error.name === 'AbortError') {
      page.status = 'cancelled';
      page.error = '';
    } else {
      page.status = 'error';
      page.error = pageErrorMessage(error, capture);
    }
  } finally {
    if (isCurrentPageEntry(page, entry)) persistAndRenderCaptures();
  }
}

function isCurrentPageEntry(page, entry) {
  return entry.token === state.runToken && page.version === entry.version;
}

function pageErrorMessage(error, capture) {
  if (error.code === 'AI_NOT_CONFIGURED' && capture.mimeType === 'application/pdf') {
    return 'Este PDF necesita un proveedor compatible o revisión manual.';
  }
  if (String(error.code || '').startsWith('AI_')) {
    return `${error.message}. El OCR de esta imagen se conserva; corrige la conexión, desactiva IA o reintenta.`;
  }
  return `${error.message}. Reintenta esta imagen o retírala del borrador.`;
}

function cancelCaptureProcessing(index) {
  const capture = state.captures[index];
  if (!capture) return;
  const key = captureKey(capture);
  const page = state.pageStates.get(key);
  if (!page) return;
  page.version += 1;
  state.pageQueue = state.pageQueue.filter(entry => entry.key !== key);
  for (const task of state.activePageTasks.values()) {
    if (task.key === key && task.token === state.runToken) task.controller.abort();
  }
  page.status = 'cancelled';
  page.elapsedMs = page.startedAt ? Date.now() - page.startedAt : page.elapsedMs;
  page.error = '';
  persistAndRenderCaptures();
  $('#receipt-state').textContent = `Imagen ${index + 1} cancelada. Las demás continúan y el OCR parcial se conserva.`;
  pumpPageQueue();
}

function retryCaptureProcessing(index) {
  const capture = state.captures[index];
  if (!capture) return;
  const key = captureKey(capture);
  const previous = state.pageStates.get(key) ?? createPageState();
  for (const task of state.activePageTasks.values()) {
    if (task.key === key && task.token === state.runToken) task.controller.abort();
  }
  state.pageQueue = state.pageQueue.filter(entry => entry.key !== key);
  const page = createPageState(previous);
  state.pageStates.set(key, page);
  state.verifyWithAi = state.aiConfigured && $('#verify-receipt-ai').checked;
  state.processing = true;
  setBusy($('#extract-receipt'), true);
  if (!state.progressVisible) startReceiptProgress();
  enqueueCapture(capture, state.verifyWithAi);
  persistAndRenderCaptures();
  $('#receipt-state').textContent = `Reintentando la imagen ${index + 1}.`;
  pumpPageQueue();
}

function cancelReceiptExtraction() {
  const activeToken = state.runToken;
  state.pageQueue = state.pageQueue.filter(entry => entry.token !== activeToken);
  for (const task of state.activePageTasks.values()) {
    if (task.token === activeToken) task.controller.abort();
  }
  state.assemblyController?.abort();
  for (const page of state.pageStates.values()) {
    if (page.status === 'pending' || ACTIVE_PAGE_STATUSES.has(page.status)) {
      page.version += 1;
      page.status = 'cancelled';
      page.elapsedMs = page.startedAt ? Date.now() - page.startedAt : page.elapsedMs;
      page.error = '';
    }
  }
  state.runToken += 1;
  state.processing = false;
  state.finalizing = false;
  setBusy($('#extract-receipt'), false);
  persistAndRenderCaptures();
  $('#receipt-state').textContent = 'Análisis cancelado. Las capturas, los OCR parciales y las páginas completadas se conservan.';
}

async function finishCurrentRunWhenIdle() {
  if (!state.processing || state.finalizing) return;
  const currentActive = [...state.activePageTasks.values()]
    .some(task => task.token === state.runToken);
  const currentPending = state.pageQueue.some(entry => entry.token === state.runToken);
  if (currentActive || currentPending) return;

  const pages = state.captures.map(capture => state.pageStates.get(captureKey(capture)));
  if (pages.every(page => page?.status === 'completed')) {
    await assembleCompletedPages(state.runToken);
    return;
  }

  state.processing = false;
  setBusy($('#extract-receipt'), false);
  stopReceiptProgress();
  updateGlobalProgress();
  const failed = pages.filter(page => page?.status === 'error').length;
  const cancelled = pages.filter(page => page?.status === 'cancelled').length;
  $('#receipt-state').textContent = `${failed} imágenes con error y ${cancelled} canceladas. Reintenta o retira esas imágenes para preparar la revisión.`;
}

async function assembleCompletedPages(token) {
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
    $('#receipt-state').textContent = articleCount === undefined
      ? 'Todas las imágenes están combinadas. Revisa las líneas, cantidades y total antes de confirmar.'
      : `Todas las imágenes están combinadas. El ticket indica ${articleCount} artículos; revisa las líneas y el total.`;
  } catch (error) {
    if (error.name !== 'AbortError' && token === state.runToken) {
      $('#receipt-state').textContent = `${error.message}. Las páginas completadas se conservan; vuelve a procesar para combinar.`;
    }
  } finally {
    if (token === state.runToken) {
      state.processing = false;
      state.finalizing = false;
      state.assemblyController = null;
      setBusy($('#extract-receipt'), false);
      stopReceiptProgress();
      updateGlobalProgress();
      persistAndRenderCaptures();
    }
  }
}

function canonicalPageText(page) {
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

function readReceiptItems() {
  return $$('.receipt-item').map(fieldset => {
    const index = Number(fieldset.dataset.itemIndex);
    const previous = state.items[index] || {};
    return {
      index,
      description: fieldset.querySelector('[data-field="description"]').value.trim(),
      quantity: Number(fieldset.querySelector('[data-field="quantity"]').value),
      unitPriceMinor: euroInputToMinor(fieldset.querySelector('[data-field="unitPriceEuro"]').value),
      lineTotalMinor: euroInputToMinor(fieldset.querySelector('[data-field="lineTotalEuro"]').value),
      ...(previous.discountMinor === undefined ? {} : { discountMinor: previous.discountMinor }),
      ...(previous.taxCategory ? { taxCategory: previous.taxCategory } : {}),
      ...(previous.sourceLines ? { sourceLines: previous.sourceLines } : {}),
      confidence: 1,
      userConfirmed: true,
    };
  }).sort((left, right) => left.index - right.index).map(({ index, ...item }) => item);
}

function collectCorrections(items) {
  const corrections = [];
  items.forEach((item, itemIndex) => {
    const original = state.originalItems[itemIndex];
    if (!original) return;
    for (const field of ['description', 'quantity', 'unitPriceMinor', 'lineTotalMinor']) {
      if (item[field] !== original[field]) {
        corrections.push({ itemIndex, field, original: original[field], corrected: item[field] });
      }
    }
  });
  return corrections;
}

function pageAiEvidence() {
  return state.captures.flatMap((capture, position) => {
    const page = state.pageStates.get(captureKey(capture));
    const interpretation = page?.result?.ai?.interpretation;
    return interpretation ? [{ position, interpretation }] : [];
  });
}

function providerLabel() {
  const sources = new Set();
  for (const capture of state.captures) {
    const page = state.pageStates.get(captureKey(capture));
    const source = page?.result?.pages?.[0]?.source;
    if (source) sources.add(source === 'embedded-text' ? 'local-tesseract' : source);
    if (page?.result?.ai) sources.add('ai-verification');
  }
  return [...sources].join('+') || 'manual';
}

function serializeManualItems(items) {
  return items.map(item => [
    item.description,
    item.quantity,
    minorToEuroInput(item.unitPriceMinor),
    minorToEuroInput(item.lineTotalMinor),
  ].join(';')).join('\n');
}

async function createImportKey(originalText) {
  const source = `${state.captures.map(capture => capture.storageKey).join('|')}|${originalText}`;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(source));
  return `receipt-${[...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('')}`;
}

async function validateRows() {
  if (!$('.receipt-item')) addBlankLine();
  const button = $('#review-receipt');
  setBusy(button, true);
  try {
    const items = readReceiptItems();
    const declaredTotalMinor = euroInputToMinor($('#receipt-total').value);
    const validation = await api('/api/v1/receipts/validate', {
      method: 'POST',
      body: JSON.stringify({ declaredTotalMinor, items }),
    });
    state.items = items;
    renderReview(items.map((_, index) => validation.lines[index]?.validation || {}), validation.total);
    $('#receipt-state').textContent = validation.total.valid
      ? 'Líneas y total validados.'
      : 'El total no coincide. Corrige los importes en euros antes de confirmar.';
  } catch (error) {
    $('#receipt-state').textContent = `Revisa las filas: ${error.message}`;
  } finally {
    setBusy(button, false);
  }
}

function normalizeRetailerName(name) {
  return String(name || '').replace(/\s+/gu, ' ').trim();
}

function setRetailerValue(value) {
  state.settingRetailerValue = true;
  $('#receipt-retailer').value = value;
  state.settingRetailerValue = false;
}

function applyRetailerCandidate(name) {
  const normalized = normalizeRetailerName(name);
  if (!normalized) return;
  const key = normalized.toLocaleLowerCase('es-ES');
  if (!state.retailerCandidates.has(key)) state.retailerCandidates.set(key, normalized);
  if (state.retailerManuallyEdited) return;
  const candidates = [...state.retailerCandidates.values()];
  if (candidates.length === 1) {
    setRetailerValue(candidates[0]);
    hideRetailerSuggestions();
    return;
  }
  setRetailerValue('');
  renderDetectedRetailerChoices(candidates);
  $('#receipt-state').textContent = 'Las imágenes contienen comercios distintos. Elige el comercio correcto antes de confirmar.';
}

function hideRetailerSuggestions() {
  const suggestions = $('#retailer-suggestions');
  suggestions.hidden = true;
  suggestions.replaceChildren();
  $('#receipt-retailer').setAttribute('aria-expanded', 'false');
}

function renderRetailerSuggestions(suggestions) {
  const container = $('#retailer-suggestions');
  container.replaceChildren();
  if (suggestions.length === 0) {
    hideRetailerSuggestions();
    return;
  }
  for (const suggestion of suggestions) {
    appendRetailerOption(container, suggestion.name, suggestion.receiptCount === 1
      ? '1 ticket guardado'
      : `${suggestion.receiptCount} tickets guardados`);
  }
  container.hidden = false;
  $('#receipt-retailer').setAttribute('aria-expanded', 'true');
}

function renderDetectedRetailerChoices(candidates) {
  const container = $('#retailer-suggestions');
  container.replaceChildren();
  for (const candidate of candidates) appendRetailerOption(container, candidate, 'Detectado en una imagen');
  container.hidden = false;
  $('#receipt-retailer').setAttribute('aria-expanded', 'true');
}

function appendRetailerOption(container, retailerName, detail) {
  const option = document.createElement('button');
  option.type = 'button';
  option.className = 'retailer-suggestion';
  option.dataset.retailerName = retailerName;
  option.setAttribute('role', 'option');
  const name = document.createElement('strong');
  name.textContent = retailerName;
  const usage = document.createElement('small');
  usage.textContent = detail;
  option.append(name, usage);
  container.append(option);
}

function scheduleRetailerSuggestions() {
  if (!state.settingRetailerValue) state.retailerManuallyEdited = true;
  clearTimeout(state.retailerSuggestionTimer);
  state.retailerSuggestionController?.abort();
  const query = $('#receipt-retailer').value.trim();
  if (query.length < 2) {
    hideRetailerSuggestions();
    return;
  }
  const controller = new AbortController();
  state.retailerSuggestionController = controller;
  state.retailerSuggestionTimer = setTimeout(async () => {
    if (controller.signal.aborted) return;
    try {
      const result = await api(`/api/v1/retailers/suggestions?q=${encodeURIComponent(query)}`, {
        signal: controller.signal,
      });
      if (controller.signal.aborted || $('#receipt-retailer').value.trim() !== query) return;
      renderRetailerSuggestions(result.suggestions || []);
    } catch (error) {
      if (error.name !== 'AbortError') hideRetailerSuggestions();
    }
  }, 180);
}

function selectRetailerSuggestion(event) {
  const option = event.target.closest('[data-retailer-name]');
  if (!option) return;
  setRetailerValue(option.dataset.retailerName);
  state.retailerManuallyEdited = true;
  hideRetailerSuggestions();
  $('#receipt-retailer').focus();
}

function allCapturesCompleted() {
  return state.captures.length > 0 && state.captures.every(capture => (
    state.pageStates.get(captureKey(capture))?.status === 'completed'
  ));
}

async function confirmReceipt() {
  if (!allCapturesCompleted() || state.processing || state.finalizing) {
    $('#receipt-state').textContent = 'Completa, reintenta o retira todas las imágenes antes de confirmar el ticket.';
    return;
  }
  let items;
  let declaredTotalMinor;
  try {
    items = readReceiptItems();
    declaredTotalMinor = euroInputToMinor($('#receipt-total').value);
  } catch (error) {
    $('#receipt-state').textContent = error.message;
    return;
  }
  if (items.length === 0) {
    $('#receipt-state').textContent = 'No hay líneas para importar.';
    return;
  }
  const originalText = state.originalText.trim() || serializeManualItems(items);
  const retailerName = $('#receipt-retailer').value.trim();
  const button = $('#confirm-receipt');
  setBusy(button, true);
  $('#receipt-state').textContent = 'Validando ticket…';
  try {
    const validation = await api('/api/v1/receipts/validate', {
      method: 'POST',
      body: JSON.stringify({ declaredTotalMinor, items }),
    });
    state.items = items;
    renderReview(items.map((_, index) => validation.lines[index]?.validation || {}), validation.total);
    if (!validation.total.valid) {
      $('#receipt-state').textContent = 'El total no coincide. Corrige las líneas o el total antes de confirmar.';
      return;
    }

    $('#receipt-state').textContent = 'Importando ticket…';
    const aiPages = pageAiEvidence();
    const result = await api('/api/v1/receipts/confirm', {
      method: 'POST',
      body: JSON.stringify({
        importKey: await createImportKey(originalText),
        originalText,
        declaredTotalMinor,
        provider: providerLabel(),
        ...(retailerName ? { retailerName } : {}),
        deterministic: state.extraction?.deterministic || { items },
        ...(aiPages.length > 0 ? { ai: { pages: aiPages } } : {}),
        captures: state.captures.map(capture => ({
          storageKey: capture.storageKey,
          contentHash: capture.contentHash,
          mimeType: capture.mimeType,
          originalName: capture.name,
        })),
        items,
        corrections: collectCorrections(items),
      }),
    });
    $('#receipt-state').textContent = `Ticket importado: ${result.receiptId}`;
    toast('Ticket confirmado');
    abortPageWork();
    state.captures = [];
    state.pageStates.clear();
    state.extraction = null;
    state.items = [];
    state.originalItems = [];
    state.originalText = '';
    state.processing = false;
    state.progressVisible = false;
    persistAndRenderCaptures();
    $('#receipt-progress').hidden = true;
    $('#receipt-review').hidden = true;
    $('#confirm-receipt').hidden = true;
    $('#receipt-total').value = '0.00';
    setRetailerValue('');
    state.retailerManuallyEdited = false;
    state.retailerCandidates.clear();
    hideRetailerSuggestions();
  } catch (error) {
    $('#receipt-state').textContent = `Revisa el ticket: ${error.message}. El borrador se conserva.`;
  } finally {
    setBusy(button, false);
  }
}

function installReceiptEnhancements() {
  const workflow = $('.receipt-workflow');
  const extractButton = $('#extract-receipt');
  if (workflow && extractButton && !$('#receipt-progress')) {
    const progress = document.createElement('section');
    progress.id = 'receipt-progress';
    progress.className = 'receipt-progress';
    progress.hidden = true;
    progress.setAttribute('aria-live', 'polite');
    progress.innerHTML = `
      <div class="receipt-progress__heading">
        <strong id="receipt-progress-stage">Preparando imágenes</strong>
        <span id="receipt-progress-elapsed">0 s</span>
      </div>
      <div id="receipt-progress-track" class="receipt-progress__track" role="progressbar" aria-label="Imágenes completadas" aria-valuetext="Sin iniciar"></div>
      <div class="receipt-progress__meta">
        <span id="receipt-progress-captures">0 imágenes completadas</span>
        <span id="receipt-progress-detail">Hasta dos imágenes se procesan a la vez.</span>
      </div>
      <button id="cancel-receipt-extraction" class="button secondary receipt-progress__cancel" type="button">Cancelar todo</button>`;
    extractButton.insertAdjacentElement('afterend', progress);
  }

  const manualBody = $('.manual-entry .details-body');
  if (manualBody && !$('#receipt-retailer')) {
    const retailer = document.createElement('div');
    retailer.className = 'retailer-field';
    retailer.innerHTML = `
      <label class="field" for="receipt-retailer">
        <span>Comercio (opcional)</span>
        <input id="receipt-retailer" maxlength="120" autocomplete="organization" placeholder="Ej. Mercadona" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="retailer-suggestions">
      </label>
      <div id="retailer-suggestions" class="retailer-suggestions" role="listbox" aria-label="Comercios guardados o detectados" hidden></div>`;
    manualBody.prepend(retailer);
  }
}

function bindEvents() {
  for (const input of [$('#receipt-files'), $('#receipt-camera')]) {
    input.addEventListener('change', async event => {
      await uploadFiles(event.target.files);
      event.target.value = '';
    });
  }
  $('#capture-list').addEventListener('click', handleCaptureAction);
  $('#receipt-review').addEventListener('click', handleReceiptAction);
  $('#close-capture-preview').addEventListener('click', () => {
    $('#capture-preview-image').removeAttribute('src');
    closeDialog($('#capture-preview-dialog'));
  });
  $('#extract-receipt').addEventListener('click', processReceipt);
  $('#cancel-receipt-extraction').addEventListener('click', cancelReceiptExtraction);
  $('#review-receipt').addEventListener('click', () => void validateRows());
  $('#confirm-receipt').addEventListener('click', () => void confirmReceipt());
  $('#add-manual-line').addEventListener('click', addBlankLine);
  $('#receipt-retailer').addEventListener('input', scheduleRetailerSuggestions);
  $('#receipt-retailer').addEventListener('keydown', event => {
    if (event.key === 'Escape') hideRetailerSuggestions();
  });
  $('#receipt-retailer').addEventListener('blur', () => setTimeout(hideRetailerSuggestions, 120));
  $('#retailer-suggestions').addEventListener('click', selectRetailerSuggestion);
  document.addEventListener('basketra:swipe-action', event => {
    if (event.detail?.kind !== 'receipt-line' || event.detail?.action !== 'delete') return;
    deleteReceiptLine(Number(event.detail.id));
  });
}

export function initReceipts(options) {
  metadata = options.metadata;
  toast = options.toast;
  state.aiConfigured = options.aiConfigured === true;
  installReceiptEnhancements();
  const aiToggle = $('#verify-receipt-ai');
  aiToggle.checked = false;
  aiToggle.disabled = !state.aiConfigured;
  $('#receipt-ai-help').textContent = state.aiConfigured
    ? 'Opcional: cada imagen pasa por OCR local y después se revisa por separado con tu proveedor.'
    : 'OCR local en español activo; no necesita cuenta ni conexión externa.';
  bindEvents();
  ensurePageStates();
  persistAndRenderCaptures();
}
