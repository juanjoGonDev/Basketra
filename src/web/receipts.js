import { api, realtimeEndpoint, setBusy } from './api.js';
import { buildReceiptAiRecovery } from './receipt-ai-recovery.js';
import {
  loadCaptures,
  loadReceiptExtractionJobId,
  loadReceiptExtractionJobs,
  saveCaptures,
  saveReceiptExtractionJobId,
  saveReceiptExtractionJobs,
} from './state.js';
import { captureItem, euroInputToMinor, minorToEuroInput, receiptReview } from './ui.js';

const ACTIVE_JOB_STATUSES = new Set(['queued', 'running']);
const ACTIVE_PAGE_STATUSES = new Set(['preparing']);
const REVIEWABLE_PAGE_STATUSES = new Set(['completed', 'ai-warning', 'manual']);
const PAGE_LABELS = {
  pending: 'En cola',
  preparing: 'Procesando',
  completed: 'Completada',
  'ai-warning': 'OCR listo · IA pendiente',
  manual: 'Revisión manual',
  error: 'Error',
  cancelled: 'Cancelada',
};
const RECEIPT_FIELDS = ['description', 'quantity', 'unitPriceMinor', 'lineTotalMinor'];
const INPUT_TO_ITEM_FIELD = {
  description: 'description',
  quantity: 'quantity',
  unitPriceEuro: 'unitPriceMinor',
  lineTotalEuro: 'lineTotalMinor',
};

const persistedJobs = loadReceiptExtractionJobs();
const state = {
  captures: loadCaptures(),
  extraction: null,
  items: [],
  originalItems: [],
  originalText: '',
  aiConfigured: false,
  pageStates: new Map(),
  jobs: new Map(persistedJobs.map(job => [job.id, { ...job, captureKeys: [...job.captureKeys] }])),
  legacyJobId: loadReceiptExtractionJobId(),
  jobRealtime: null,
  jobSubmissions: 0,
  jobGeneration: 0,
  runToken: 0,
  processing: false,
  finalizing: false,
  restoringJobs: false,
  reviewRefreshBlocked: false,
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
  manualOverrides: new Map(),
  deletedEvidenceKeys: new Set(),
  manualRows: [],
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

function itemEvidenceKey(item) {
  if (!item?.captureStorageKey || !Array.isArray(item.sourceLines) || item.sourceLines.length === 0) return '';
  return `${item.captureStorageKey}:${item.sourceLines.join(',')}`;
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
    errorCode: '',
    recovery: null,
    jobId: '',
    aiStatus: 'idle',
    aiErrorCode: '',
    ...previous,
    status: 'pending',
    startedAt: 0,
    elapsedMs: 0,
    rawText: '',
    result: null,
    error: '',
    errorCode: '',
    recovery: null,
    jobId: '',
    aiStatus: 'idle',
    aiErrorCode: '',
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

function activeJobs() {
  return [...state.jobs.values()].filter(job => ACTIVE_JOB_STATUSES.has(job.status));
}

function syncProcessingState() {
  state.processing = state.finalizing || state.jobSubmissions > 0 || activeJobs().length > 0;
  return state.processing;
}

function persistReceiptJobs() {
  const currentKeys = new Set(state.captures.map(captureKey));
  for (const [id, job] of state.jobs) {
    job.captureKeys = job.captureKeys.filter(key => currentKeys.has(key));
    if (job.captureKeys.length === 0) state.jobs.delete(id);
  }
  saveReceiptExtractionJobs([...state.jobs.values()]);
  saveReceiptExtractionJobId('');
}

function findJobForCapture(key, { activeOnly = false } = {}) {
  const jobs = [...state.jobs.values()].reverse();
  return jobs.find(job => job.captureKeys.includes(key) && (!activeOnly || ACTIVE_JOB_STATUSES.has(job.status)));
}

function detachCaptureFromJobs(key) {
  for (const [id, job] of state.jobs) {
    if (!job.captureKeys.includes(key)) continue;
    job.captureKeys = job.captureKeys.filter(candidate => candidate !== key);
    if (job.captureKeys.length === 0) state.jobs.delete(id);
  }
  persistReceiptJobs();
}

function captureReviewState() {
  if (!$('.receipt-item')) return true;
  let items;
  try {
    items = readReceiptItems();
  } catch {
    state.reviewRefreshBlocked = true;
    return false;
  }

  state.items = items;
  state.manualRows = items.filter(item => item.manualId).map(item => ({ ...item }));
  const originalByKey = new Map(state.originalItems.flatMap(item => {
    const key = itemEvidenceKey(item);
    return key ? [[key, item]] : [];
  }));

  for (const item of items) {
    const key = itemEvidenceKey(item);
    if (!key) continue;
    const original = originalByKey.get(key);
    if (!original) continue;
    const overrides = {};
    for (const field of RECEIPT_FIELDS) {
      if (item[field] !== original[field]) overrides[field] = item[field];
    }
    if (Object.keys(overrides).length > 0) state.manualOverrides.set(key, overrides);
    else state.manualOverrides.delete(key);
  }
  state.reviewRefreshBlocked = false;
  return true;
}

function applyPreservedReviewState(machineItems) {
  const originalByKey = new Map(machineItems.flatMap(item => {
    const key = itemEvidenceKey(item);
    return key ? [[key, item]] : [];
  }));
  const merged = machineItems
    .filter(item => {
      const key = itemEvidenceKey(item);
      return !key || !state.deletedEvidenceKeys.has(key);
    })
    .map(item => {
      const key = itemEvidenceKey(item);
      const overrides = key ? state.manualOverrides.get(key) : undefined;
      return overrides ? { ...item, ...overrides, userConfirmed: true } : { ...item };
    });

  for (const manualItem of state.manualRows) merged.push({ ...manualItem });
  state.originalItems = [...originalByKey.values()].map(item => ({ ...item }));
  return merged;
}

function clearPreservedReviewState() {
  state.manualOverrides.clear();
  state.deletedEvidenceKeys.clear();
  state.manualRows = [];
  state.reviewRefreshBlocked = false;
}

function invalidateAssembledReview() {
  state.runToken += 1;
  state.assemblyController?.abort();
  state.assemblyController = null;
  state.finalizing = false;
  state.extraction = null;
  state.items = [];
  state.originalItems = [];
  state.originalText = '';
  state.manualReviewRequired = false;
  state.retailerCandidates.clear();
  state.retailerManuallyEdited = false;
  const review = $('#receipt-review');
  if (review) review.hidden = true;
  const confirm = $('#confirm-receipt');
  if (confirm) confirm.hidden = true;
  if ($('#receipt-total')) $('#receipt-total').value = '0.00';
  if ($('#receipt-retailer')) setRetailerValue('');
  if ($('#retailer-suggestions')) hideRetailerSuggestions();
  syncProcessingState();
}

function clearReceiptExtractionJobs({ cancel = false } = {}) {
  state.jobGeneration += 1;
  const jobs = [...state.jobs.values()];
  state.jobs.clear();
  persistReceiptJobs();
  if (cancel) {
    for (const job of jobs) {
      if (!ACTIVE_JOB_STATUSES.has(job.status)) continue;
      void api(`/api/v1/receipts/extraction-jobs/${encodeURIComponent(job.id)}`, { method: 'DELETE' }).catch(() => {});
    }
  }
  state.jobRealtime?.close();
  state.jobRealtime = null;
  syncProcessingState();
}

function resetAllReceiptProcessing() {
  clearReceiptExtractionJobs({ cancel: true });
  state.runToken += 1;
  state.assemblyController?.abort();
  state.assemblyController = null;
  state.finalizing = false;
  state.extraction = null;
  state.items = [];
  state.originalItems = [];
  state.originalText = '';
  state.manualReviewRequired = false;
  state.retailerCandidates.clear();
  clearPreservedReviewState();
  ensurePageStates();
  for (const [key, page] of state.pageStates) state.pageStates.set(key, createPageState(page));
  $('#receipt-review').hidden = true;
  $('#confirm-receipt').hidden = true;
  $('#receipt-state').textContent = '';
  stopReceiptProgress({ hide: true });
  syncProcessingState();
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

  list.querySelectorAll('img[data-capture-preview-image]').forEach(image => {
    image.addEventListener('error', () => {
      image.hidden = true;
      if (image.nextElementSibling) image.nextElementSibling.hidden = false;
    }, { once: true });
  });
  updateGlobalProgress();
}

function pageIsActive(page) {
  if (ACTIVE_PAGE_STATUSES.has(page.status)) return true;
  if (!page.jobId) return false;
  return ACTIVE_JOB_STATUSES.has(state.jobs.get(page.jobId)?.status);
}

function pageStatusLabel(page) {
  if (page.aiStatus === 'warning') return PAGE_LABELS['ai-warning'];
  if ((page.aiStatus === 'queued' || page.aiStatus === 'processing') && page.result) return 'OCR listo · IA en cola';
  return PAGE_LABELS[page.status] || PAGE_LABELS.pending;
}

function renderCaptureProgress(card, capture, index) {
  const page = state.pageStates.get(captureKey(capture)) ?? createPageState();
  const active = pageIsActive(page);
  const section = document.createElement('section');
  section.className = 'capture-card__progress';
  section.dataset.capturePageProgress = captureKey(capture);
  section.setAttribute('aria-live', 'polite');

  const heading = document.createElement('div');
  heading.className = 'capture-card__progress-heading';
  const position = document.createElement('strong');
  position.textContent = `Imagen ${index + 1} de ${state.captures.length}`;
  const status = document.createElement('span');
  status.className = `status-pill ${pageStatusClass(page)}`;
  status.textContent = pageStatusLabel(page);
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

  if (active || page.status === 'error' || page.status === 'cancelled' || page.aiStatus === 'warning') {
    const actions = document.createElement('div');
    actions.className = 'capture-card__page-actions';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'button secondary';
    button.dataset.captureIndex = String(index);
    if (active) {
      button.dataset.captureAction = 'cancel-processing';
      button.textContent = page.result ? 'Cancelar reintento de IA' : 'Cancelar esta imagen';
    } else if (page.aiStatus === 'warning') {
      button.dataset.captureAction = 'retry-ai';
      button.textContent = 'Reintentar IA';
    } else {
      button.dataset.captureAction = 'retry-processing';
      button.textContent = page.recovery?.retryLabel || 'Reintentar imagen';
    }
    actions.append(button);

    if (page.aiStatus === 'warning') {
      const manualButton = document.createElement('button');
      manualButton.type = 'button';
      manualButton.className = 'button secondary';
      manualButton.dataset.captureIndex = String(index);
      manualButton.dataset.captureAction = 'review-capture';
      manualButton.textContent = 'Revisar manualmente';
      actions.append(manualButton);
    } else if (page.status === 'error' && page.recovery?.allowManualReview) {
      const manualButton = document.createElement('button');
      manualButton.type = 'button';
      manualButton.className = 'button secondary';
      manualButton.dataset.captureIndex = String(index);
      manualButton.dataset.captureAction = 'manual-review';
      manualButton.textContent = page.recovery.manualLabel;
      actions.append(manualButton);
    }

    section.append(actions);
  }

  card.append(section);
  card.querySelectorAll('[data-capture-action="up"], [data-capture-action="down"], [data-capture-action="delete"]')
    .forEach(button => {
      if (active) button.disabled = true;
    });
}

function pageStatusClass(page) {
  if (page.aiStatus === 'warning') return 'warning';
  if (page.status === 'completed') return 'success';
  if (page.status === 'manual') return 'warning';
  if (page.status === 'error') return 'error';
  if (page.status === 'cancelled') return 'warning';
  return '';
}

function pageStageValue(status) {
  if (status === 'preparing') return 1;
  if (status === 'completed' || status === 'ai-warning' || status === 'manual') return 3;
  return 0;
}

function pageStageDescription(page) {
  if ((page.aiStatus === 'queued' || page.aiStatus === 'processing') && page.result) {
    return 'OCR conservado; esperando un hueco en el pool de IA';
  }
  if (page.aiStatus === 'warning') return 'OCR completado; la IA falló sin descartar los datos';
  if (page.status === 'pending' && page.jobId) return 'En cola; el servidor asignará OCR e IA según capacidad';
  if (page.status === 'pending') return 'Pendiente de procesamiento automático';
  if (page.status === 'preparing') return state.aiConfigured
    ? 'Procesando en los pools compartidos de OCR e IA'
    : 'Procesando en el pool compartido de OCR local';
  if (page.status === 'completed') return state.aiConfigured
    ? 'OCR y verificación automática terminados'
    : 'OCR local terminado';
  if (page.status === 'manual') return 'OCR conservado; cantidades e importes requieren revisión manual';
  if (page.status === 'cancelled') return 'Esta imagen no se incluirá hasta reintentar';
  if (page.status === 'error') return 'La captura y cualquier evidencia parcial se conservan';
  return '';
}

function pagePartialText(page) {
  if (page.status === 'error') return page.error || 'No se pudo procesar esta imagen.';
  const itemCount = page.result?.final?.items?.length;
  if (page.aiStatus === 'warning' && Number.isSafeInteger(itemCount)) {
    return `${itemCount} ${itemCount === 1 ? 'línea OCR disponible' : 'líneas OCR disponibles'} · puedes reintentar sólo la IA`;
  }
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
  const uploaded = [];
  try {
    files.forEach(validateFile);
    for (const [index, file] of files.entries()) {
      $('#upload-state').textContent = `Subiendo ${index + 1} de ${files.length}: ${file.name || 'captura'}…`;
      const base64 = await fileToBase64(file);
      const result = await api('/api/v1/files', {
        method: 'POST',
        body: JSON.stringify({ base64, mimeType: file.type, originalName: file.name || 'captura' }),
      });
      if (state.captures.some(capture => capture.storageKey === result.file.storageKey)) continue;
      const capture = {
        name: file.name || `captura-${Date.now()}`,
        mimeType: result.file.mimeType,
        bytes: result.file.bytes,
        storageKey: result.file.storageKey,
        contentHash: result.file.hash,
      };
      state.captures.push(capture);
      uploaded.push(capture);
    }
    if (uploaded.length === 0) {
      $('#upload-state').textContent = 'Estas capturas ya estaban añadidas.';
      return;
    }
    captureReviewState();
    invalidateAssembledReview();
    ensurePageStates();
    persistAndRenderCaptures();
    $('#upload-state').textContent = state.aiConfigured
      ? 'Capturas guardadas. OCR e IA empiezan automáticamente.'
      : 'Capturas guardadas. El OCR local empieza automáticamente.';
    toast(uploaded.length === 1 ? 'Captura guardada y en cola' : 'Capturas guardadas y en cola');
    await startReceiptBackgroundJob(uploaded);
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
  syncProcessingState();
  if (state.processing || state.finalizing) return;
  const target = index + direction;
  if (!state.captures[index] || !state.captures[target]) return;
  [state.captures[index], state.captures[target]] = [state.captures[target], state.captures[index]];
  captureReviewState();
  invalidateAssembledReview();
  persistAndRenderCaptures();
  void maybeAssembleReceipt();
}

function deleteCapture(index) {
  syncProcessingState();
  if (state.processing || state.finalizing || !state.captures[index]) return;
  captureReviewState();
  const [removed] = state.captures.splice(index, 1);
  if (removed) {
    state.pageStates.delete(captureKey(removed));
    detachCaptureFromJobs(captureKey(removed));
  }
  invalidateAssembledReview();
  persistAndRenderCaptures();
  $('#upload-state').textContent = 'Captura retirada del borrador; la evidencia original se conserva';
  void maybeAssembleReceipt();
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
  if (action === 'cancel-processing') void cancelCaptureProcessing(index);
  if (action === 'retry-processing') void retryCaptureProcessing(index);
  if (action === 'retry-ai') void retryCaptureAi(index);
  if (action === 'review-capture') reviewCaptureEvidence(index);
  if (action === 'manual-review') useManualReview(index);
}

function requestExtraction(captures, verifyWithAi, signal) {
  return api('/api/v1/receipts/extract', {
    method: 'POST',
    body: JSON.stringify({ captures, verifyWithAi }),
    signal,
  });
}

function requestReceiptExtractionJob(captures, verifyWithAi) {
  return api('/api/v1/receipts/extraction-jobs', {
    method: 'POST',
    body: JSON.stringify({ captures, verifyWithAi }),
  });
}

function captureRequest(capture, embeddedText) {
  return {
    storageKey: capture.storageKey,
    originalName: capture.name,
    ...(embeddedText ? { embeddedText } : {}),
  };
}

function setPagesForBackgroundJob(job, status) {
  job.status = status;
  for (const key of job.captureKeys) {
    const page = state.pageStates.get(key);
    if (!page) continue;
    page.jobId = job.id;
    page.startedAt ||= Date.now();
    if (job.mode === 'ai-retry' && page.result) {
      page.aiStatus = status === 'running' ? 'processing' : 'queued';
      page.status = 'ai-warning';
      page.aiErrorCode = '';
      continue;
    }
    page.status = status === 'running' ? 'preparing' : 'pending';
    page.aiStatus = state.aiConfigured ? 'queued' : 'disabled';
    page.error = '';
    page.errorCode = '';
    page.recovery = null;
  }
}

function sourceRegionForItem(item, evidence) {
  if (item.sourceRegion) return item.sourceRegion;
  if (!Array.isArray(item.sourceLines) || !Array.isArray(evidence?.lines)) return undefined;
  const regions = item.sourceLines.flatMap(index => {
    const line = evidence.lines.find(candidate => candidate?.index === index);
    return line?.region ? [line.region] : [];
  });
  if (regions.length === 0) return undefined;
  const x = Math.min(...regions.map(region => region.x));
  const y = Math.min(...regions.map(region => region.y));
  const right = Math.max(...regions.map(region => region.x + region.width));
  const bottom = Math.max(...regions.map(region => region.y + region.height));
  return { x, y, width: right - x, height: bottom - y };
}

function decorateEvidenceItem(item, evidence) {
  const sourceRegion = sourceRegionForItem(item, evidence);
  return {
    ...item,
    captureStorageKey: evidence?.storageKey || item.captureStorageKey,
    ...(sourceRegion ? { sourceRegion } : {}),
  };
}

function pageResultFromEvidence(extraction, evidence, singleCapture) {
  if (!evidence && singleCapture) return extraction;
  if (!evidence) return null;
  const deterministic = evidence.deterministic || { items: [], metadata: {} };
  const interpretation = evidence.ai?.interpretation;
  const metadata = deterministic.metadata || {};
  const selectedItems = interpretation?.items?.length ? interpretation.items : (deterministic.items || []);
  const items = selectedItems.map(item => decorateEvidenceItem(item, evidence));
  const retailerName = interpretation?.retailerName ?? metadata.retailerName;
  const declaredTotalMinor = interpretation?.declaredTotalMinor ?? metadata.declaredTotalMinor;
  const articleCount = interpretation?.articleCount ?? metadata.articleCount;
  const final = {
    items,
    ...(retailerName ? { retailerName } : {}),
    ...(declaredTotalMinor === undefined ? {} : { declaredTotalMinor }),
    ...(articleCount === undefined ? {} : { articleCount }),
  };
  return {
    pages: [evidence],
    originalText: evidence.text || '',
    deterministic: {
      items: (deterministic.items || []).map(item => decorateEvidenceItem(item, evidence)),
      ...(metadata.retailerName ? { retailerName: metadata.retailerName } : {}),
      ...(metadata.declaredTotalMinor === undefined ? {} : { declaredTotalMinor: metadata.declaredTotalMinor }),
      ...(metadata.articleCount === undefined ? {} : { articleCount: metadata.articleCount }),
    },
    ...(interpretation ? { ai: { interpretation, attempts: evidence.ai?.attempts || 1 } } : {}),
    ...(evidence.aiFailure ? { aiFailure: evidence.aiFailure } : {}),
    final,
  };
}

function mergedRetryEvidence(page, retryEvidence) {
  const originalEvidence = page.result?.pages?.[0];
  if (!originalEvidence) return retryEvidence;
  const merged = { ...originalEvidence };
  delete merged.ai;
  delete merged.aiFailure;
  if (retryEvidence?.ai) merged.ai = retryEvidence.ai;
  if (retryEvidence?.aiFailure) merged.aiFailure = retryEvidence.aiFailure;
  return merged;
}

function completeBackgroundJob(job, extraction) {
  const pages = Array.isArray(extraction.pages) ? extraction.pages : [];
  const singleCapture = job.captureKeys.length === 1;
  for (const [position, key] of job.captureKeys.entries()) {
    const page = state.pageStates.get(key);
    if (!page) continue;
    const retryEvidence = pages.find(candidate => candidate?.position === position);
    const evidence = job.mode === 'ai-retry' ? mergedRetryEvidence(page, retryEvidence) : retryEvidence;
    page.status = evidence?.aiFailure ? 'ai-warning' : 'completed';
    page.aiStatus = evidence?.aiFailure ? 'warning' : (evidence?.ai ? 'completed' : 'disabled');
    page.aiErrorCode = evidence?.aiFailure?.code || '';
    page.jobId = job.id;
    if (job.mode !== 'ai-retry') {
      page.rawText = typeof evidence?.text === 'string'
        ? evidence.text
        : (singleCapture && typeof extraction.originalText === 'string' ? extraction.originalText : '');
    }
    page.result = pageResultFromEvidence(extraction, evidence, singleCapture);
    page.elapsedMs = page.startedAt ? Date.now() - page.startedAt : 0;
    page.error = '';
    page.errorCode = '';
    page.recovery = null;
  }
  job.status = 'completed';
  persistReceiptJobs();
  syncProcessingState();
  closeJobRealtimeIfIdle();
  persistAndRenderCaptures();
  const warnings = job.captureKeys.filter(key => state.pageStates.get(key)?.aiStatus === 'warning').length;
  $('#receipt-state').textContent = warnings > 0
    ? 'OCR completado. La IA falló en alguna captura, pero sus líneas están disponibles para revisar o importar.'
    : job.mode === 'ai-retry'
      ? 'Verificación con IA completada. Se actualizarán sólo los datos no corregidos manualmente.'
      : 'Procesamiento automático completado. Preparando la revisión conjunta…';
  if (!state.restoringJobs && !state.reviewRefreshBlocked) void maybeAssembleReceipt();
}

function failBackgroundJob(job, errorCode = 'RECEIPT_EXTRACTION_FAILED') {
  job.status = 'failed';
  for (const key of job.captureKeys) {
    const capture = captureByKey(key);
    const page = state.pageStates.get(key);
    if (!page) continue;
    if (job.mode === 'ai-retry' && page.result) {
      page.status = 'ai-warning';
      page.aiStatus = 'warning';
      page.aiErrorCode = errorCode;
      page.jobId = job.id;
      page.error = '';
      page.errorCode = '';
      page.recovery = null;
      page.elapsedMs = page.startedAt ? Date.now() - page.startedAt : page.elapsedMs;
      continue;
    }
    const recovery = buildReceiptAiRecovery({
      code: errorCode,
      message: 'No se pudo completar el procesamiento automático.',
    }, {
      mimeType: capture?.mimeType || '',
      hasOcrDraft: Boolean(page.rawText || page.result),
    });
    page.status = 'error';
    page.jobId = job.id;
    page.errorCode = errorCode;
    page.error = recovery.message;
    page.recovery = recovery;
    page.elapsedMs = page.startedAt ? Date.now() - page.startedAt : 0;
  }
  if (job.id) state.jobs.set(job.id, job);
  persistReceiptJobs();
  syncProcessingState();
  closeJobRealtimeIfIdle();
  stopReceiptProgress();
  persistAndRenderCaptures();
  $('#receipt-state').textContent = job.mode === 'ai-retry'
    ? 'No se pudo reintentar la IA. El OCR y tus cambios se conservan.'
    : 'Parte del procesamiento automático no terminó. Reintenta sólo las capturas con error.';
}

function cancelBackgroundJobState(job) {
  job.status = 'cancelled';
  for (const key of job.captureKeys) {
    const page = state.pageStates.get(key);
    if (!page) continue;
    if (job.mode === 'ai-retry' && page.result) {
      page.status = 'ai-warning';
      page.aiStatus = 'warning';
      page.jobId = '';
      page.elapsedMs = page.startedAt ? Date.now() - page.startedAt : page.elapsedMs;
      continue;
    }
    if (REVIEWABLE_PAGE_STATUSES.has(page.status)) continue;
    page.status = 'cancelled';
    page.jobId = job.id;
    page.error = '';
    page.errorCode = '';
    page.recovery = null;
    page.elapsedMs = page.startedAt ? Date.now() - page.startedAt : page.elapsedMs;
  }
  persistReceiptJobs();
  syncProcessingState();
  closeJobRealtimeIfIdle();
  persistAndRenderCaptures();
}

async function refreshReceiptExtractionJob(jobId) {
  const tracked = state.jobs.get(jobId);
  if (!tracked) return;
  const result = await api(`/api/v1/receipts/extraction-jobs/${encodeURIComponent(jobId)}`);
  const job = result.job;
  if (!job || job.id !== jobId || !state.jobs.has(jobId)) return;
  if (job.status === 'queued' || job.status === 'running') {
    setPagesForBackgroundJob(tracked, job.status);
    syncProcessingState();
    startReceiptProgress();
    persistReceiptJobs();
    persistAndRenderCaptures();
    return;
  }
  if (job.status === 'completed' && job.extraction) {
    completeBackgroundJob(tracked, job.extraction);
    return;
  }
  if (job.status === 'cancelled') {
    cancelBackgroundJobState(tracked);
    return;
  }
  failBackgroundJob(tracked, job.errorCode);
}

function ensureJobRealtime() {
  if (state.jobRealtime || activeJobs().length === 0) return;
  const source = new EventSource(realtimeEndpoint());
  state.jobRealtime = source;
  source.addEventListener('invalidate', event => {
    if (state.jobRealtime !== source) return;
    try {
      const invalidation = JSON.parse(event.data);
      const job = state.jobs.get(invalidation?.entityId);
      if (invalidation?.entityType === 'receipt-extraction-job' && job && ACTIVE_JOB_STATUSES.has(job.status)) {
        void refreshReceiptExtractionJob(job.id).catch(() => {});
      }
    } catch {
      // A later valid invalidation will retry through the same EventSource connection.
    }
  });
}

function closeJobRealtimeIfIdle() {
  if (activeJobs().length > 0) return;
  state.jobRealtime?.close();
  state.jobRealtime = null;
}

async function startReceiptBackgroundJob(captures, { mode = 'full' } = {}) {
  const queuedCaptures = captures.filter(capture => state.captures.some(current => captureKey(current) === captureKey(capture)));
  if (queuedCaptures.length === 0) return;
  const generation = state.jobGeneration;
  state.jobSubmissions += 1;
  syncProcessingState();
  startReceiptProgress();
  for (const capture of queuedCaptures) {
    const page = state.pageStates.get(captureKey(capture));
    if (!page) continue;
    page.startedAt ||= Date.now();
    if (mode === 'ai-retry' && page.result) {
      page.status = 'ai-warning';
      page.aiStatus = 'queued';
      page.aiErrorCode = '';
      continue;
    }
    page.status = 'pending';
    page.aiStatus = state.aiConfigured ? 'queued' : 'disabled';
    page.error = '';
    page.errorCode = '';
    page.recovery = null;
  }
  persistAndRenderCaptures();
  $('#receipt-state').textContent = mode === 'ai-retry'
    ? 'OCR conservado. Reintentando únicamente la verificación con IA en su cola compartida.'
    : state.aiConfigured
      ? 'Procesamiento automático activo: OCR hasta 2 en paralelo; la IA usa su cola independiente.'
      : 'Procesamiento automático activo: OCR local usa el pool compartido de hasta 2 capturas.';

  try {
    const requests = queuedCaptures.map(capture => {
      const page = state.pageStates.get(captureKey(capture));
      return captureRequest(capture, mode === 'ai-retry' ? page?.rawText : undefined);
    });
    if (mode === 'ai-retry' && requests.some(request => !request.embeddedText)) {
      throw new Error('No hay texto OCR conservado para reintentar sólo la IA');
    }
    const result = await requestReceiptExtractionJob(requests, mode === 'ai-retry' ? true : state.aiConfigured);
    const jobId = result.job?.id;
    if (typeof jobId !== 'string') throw new Error('No se recibió el identificador del procesamiento');
    if (generation !== state.jobGeneration) {
      void api(`/api/v1/receipts/extraction-jobs/${encodeURIComponent(jobId)}`, { method: 'DELETE' }).catch(() => {});
      return;
    }
    const job = {
      id: jobId,
      captureKeys: queuedCaptures.map(captureKey),
      status: result.job?.status === 'running' ? 'running' : 'queued',
      mode,
    };
    state.jobs.set(jobId, job);
    for (const key of job.captureKeys) {
      const page = state.pageStates.get(key);
      if (page) page.jobId = jobId;
    }
    persistReceiptJobs();
    ensureJobRealtime();
    await refreshReceiptExtractionJob(jobId);
  } catch (error) {
    const provisional = {
      id: '',
      captureKeys: queuedCaptures.map(captureKey),
      status: 'failed',
      mode,
    };
    failBackgroundJob(provisional, typeof error?.code === 'string' ? error.code : undefined);
  } finally {
    state.jobSubmissions = Math.max(0, state.jobSubmissions - 1);
    syncProcessingState();
    if (!state.reviewRefreshBlocked) void maybeAssembleReceipt();
  }
}

function decorateReceiptEvidenceRows() {
  $$('.receipt-item').forEach((fieldset, index) => {
    const item = state.items[index];
    if (!item) return;
    const capture = captureByKey(item.captureStorageKey);
    if (item.captureStorageKey) fieldset.dataset.captureKey = item.captureStorageKey;
    if (Array.isArray(item.sourceLines)) fieldset.dataset.sourceLines = item.sourceLines.join(',');
    if (!capture || fieldset.querySelector('.receipt-line-evidence')) return;

    const figure = document.createElement('figure');
    figure.className = 'receipt-line-evidence';
    const heading = document.createElement('div');
    heading.className = 'receipt-line-evidence__heading';
    const title = document.createElement('strong');
    title.textContent = 'Captura original';
    const detail = document.createElement('small');
    const confidence = item.fieldConfidence?.description ?? item.confidence;
    detail.textContent = Number.isFinite(confidence) ? `Confianza ${Math.round(confidence * 100)}%` : 'Evidencia OCR';
    heading.append(title, detail);
    figure.append(heading);

    if (capture.mimeType.startsWith('image/')) {
      const preview = document.createElement('button');
      preview.type = 'button';
      preview.className = 'receipt-line-evidence__preview';
      preview.setAttribute('aria-label', `Ampliar captura original ${capture.name}`);
      const image = document.createElement('img');
      image.src = `/api/v1/files/${encodeURIComponent(capture.storageKey)}`;
      image.alt = `Captura original ${capture.name} asociada a esta línea`;
      preview.append(image);
      if (item.sourceRegion) {
        const marker = document.createElement('span');
        marker.className = 'receipt-line-evidence__region';
        marker.setAttribute('aria-hidden', 'true');
        marker.style.setProperty('--source-x', `${item.sourceRegion.x * 100}%`);
        marker.style.setProperty('--source-y', `${item.sourceRegion.y * 100}%`);
        marker.style.setProperty('--source-width', `${item.sourceRegion.width * 100}%`);
        marker.style.setProperty('--source-height', `${item.sourceRegion.height * 100}%`);
        preview.append(marker);
      }
      preview.addEventListener('click', () => showPreview(state.captures.indexOf(capture)));
      figure.append(preview);
    } else {
      const note = document.createElement('p');
      note.textContent = 'El PDF original se conserva como evidencia de esta línea.';
      figure.append(note);
    }

    fieldset.querySelector('legend')?.insertAdjacentElement('afterend', figure);
  });
}

function alignedReviewLines(extraction) {
  const machineLines = extraction.final.review?.lines || [];
  const byKey = new Map(machineLines.flatMap(line => {
    const key = itemEvidenceKey(line);
    return key ? [[key, line]] : [];
  }));
  return state.items.map(item => {
    const key = itemEvidenceKey(item);
    return key ? byKey.get(key) || {} : {};
  });
}

function renderReview(lines = [], total) {
  $('#receipt-review').hidden = false;
  $('#receipt-review').innerHTML = receiptReview(state.items, lines, total);
  decorateReceiptEvidenceRows();
  $('#confirm-receipt').hidden = state.items.length === 0;
}

function applyExtraction(extraction, originalText = extraction.originalText || '') {
  state.extraction = extraction;
  const machineItems = extraction.final.items.map(item => ({ ...item }));
  state.items = applyPreservedReviewState(machineItems);
  state.originalText = originalText;
  if (extraction.final.declaredTotalMinor !== undefined) {
    $('#receipt-total').value = minorToEuroInput(extraction.final.declaredTotalMinor);
  }
  applyRetailerCandidate(extraction.final.retailerName || extraction.ai?.interpretation?.retailerName);
  $('.manual-entry').open = true;
  const hasManualState = state.manualRows.length > 0
    || state.deletedEvidenceKeys.size > 0
    || state.manualOverrides.size > 0;
  renderReview(alignedReviewLines(extraction), hasManualState ? undefined : extraction.final.review.total);
}

function createManualId() {
  return typeof crypto.randomUUID === 'function'
    ? `manual-${crypto.randomUUID()}`
    : `manual-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function addBlankLine(captureStorageKey = '') {
  try {
    if ($('.receipt-item')) state.items = readReceiptItems();
  } catch {
    // Preserve the last valid row model while the user is still editing another row.
  }
  const item = {
    description: '',
    quantity: 1,
    unitPriceMinor: 0,
    lineTotalMinor: 0,
    confidence: 0,
    userConfirmed: true,
    manualId: createManualId(),
    ...(captureStorageKey ? { captureStorageKey } : {}),
  };
  state.items.push(item);
  state.manualRows.push({ ...item });
  renderReview();
  const input = $(`.receipt-item[data-item-index="${state.items.length - 1}"] [data-field="description"]`);
  input?.focus();
}

function restoreReceiptLine(index, item, original) {
  const key = itemEvidenceKey(item);
  if (key) state.deletedEvidenceKeys.delete(key);
  state.items.splice(Math.min(index, state.items.length), 0, item);
  if (original) state.originalItems.splice(Math.min(index, state.originalItems.length), 0, original);
  if (item.manualId && !state.manualRows.some(candidate => candidate.manualId === item.manualId)) state.manualRows.push({ ...item });
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
  const key = itemEvidenceKey(item);
  if (key) state.deletedEvidenceKeys.add(key);
  if (item?.manualId) state.manualRows = state.manualRows.filter(candidate => candidate.manualId !== item.manualId);
  const originalIndex = key ? state.originalItems.findIndex(candidate => itemEvidenceKey(candidate) === key) : index;
  const [original] = originalIndex >= 0 ? state.originalItems.splice(originalIndex, 1) : [];
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
  return pageIsActive(page) && page.startedAt
    ? Date.now() - page.startedAt
    : page.elapsedMs;
}

function startReceiptProgress() {
  if (!state.progressVisible) {
    state.progressVisible = true;
    state.progressStartedAt = Date.now();
  }
  $('#receipt-progress').hidden = false;
  if (state.progressTimer) return;
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
  const completed = pages.filter(page => REVIEWABLE_PAGE_STATUSES.has(page.status)).length;
  const active = pages.filter(pageIsActive).length;
  const pending = pages.filter(page => page.status === 'pending' && !pageIsActive(page)).length;
  const failed = pages.filter(page => page.status === 'error').length;
  const cancelled = pages.filter(page => page.status === 'cancelled').length;
  const manual = pages.filter(page => page.status === 'manual').length;
  const aiWarnings = pages.filter(page => page.aiStatus === 'warning').length;
  const stage = state.finalizing
    ? 'Combinando páginas y eliminando solapamientos'
    : `${completed} de ${total} imágenes con OCR disponible`;
  $('#receipt-progress-stage').textContent = stage;
  $('#receipt-progress-captures').textContent = `${completed} de ${total} imágenes con OCR disponible`;
  $('#receipt-progress-detail').textContent = [
    active ? `${active} en cola o procesando` : '',
    pending ? `${pending} pendientes` : '',
    failed ? `${failed} con error OCR` : '',
    aiWarnings ? `${aiWarnings} con aviso de IA` : '',
    cancelled ? `${cancelled} canceladas` : '',
    manual ? `${manual} en revisión manual` : '',
  ].filter(Boolean).join(' · ') || (state.finalizing ? 'Preparando la revisión conjunta' : 'Sin tareas pendientes');
  const track = $('#receipt-progress-track');
  track.setAttribute('aria-valuemin', '0');
  track.setAttribute('aria-valuemax', String(Math.max(total, 1)));
  track.setAttribute('aria-valuenow', String(completed));
  track.setAttribute('aria-valuetext', `${stage}. ${$('#receipt-progress-detail').textContent}`);
  track.dataset.determinate = 'true';
  track.style.setProperty('--receipt-progress', `${total === 0 ? 0 : completed / total * 100}%`);
  $('#cancel-receipt-extraction').disabled = active === 0 && !state.finalizing;
}

async function cancelCaptureProcessing(index) {
  const capture = state.captures[index];
  if (!capture) return;
  const key = captureKey(capture);
  const job = findJobForCapture(key, { activeOnly: true });
  const page = state.pageStates.get(key);
  if (!page) return;

  if (!job) {
    if (page.result) {
      page.status = page.aiStatus === 'warning' ? 'ai-warning' : 'completed';
      persistAndRenderCaptures();
      return;
    }
    page.status = 'cancelled';
    page.error = '';
    page.errorCode = '';
    page.recovery = null;
    persistAndRenderCaptures();
    return;
  }

  if (job.mode === 'ai-retry' && page.result) {
    try {
      await api(`/api/v1/receipts/extraction-jobs/${encodeURIComponent(job.id)}`, { method: 'DELETE' });
    } catch {
      // Keep the usable OCR draft even if the cancellation response is lost.
    }
    state.jobs.delete(job.id);
    page.status = 'ai-warning';
    page.aiStatus = 'warning';
    page.jobId = '';
    persistReceiptJobs();
    syncProcessingState();
    persistAndRenderCaptures();
    $('#receipt-state').textContent = `Reintento de IA cancelado para la imagen ${index + 1}. El OCR se conserva.`;
    return;
  }

  const survivorCaptures = job.captureKeys
    .filter(candidate => candidate !== key)
    .map(captureByKey)
    .filter(Boolean);
  try {
    await api(`/api/v1/receipts/extraction-jobs/${encodeURIComponent(job.id)}`, { method: 'DELETE' });
  } catch {
    // The local draft still needs deterministic recovery even if the DELETE response is lost.
  }
  state.jobs.delete(job.id);
  for (const candidate of job.captureKeys) {
    const candidatePage = state.pageStates.get(candidate);
    if (!candidatePage || REVIEWABLE_PAGE_STATUSES.has(candidatePage.status)) continue;
    state.pageStates.set(candidate, createPageState(candidatePage));
  }
  const cancelledPage = state.pageStates.get(key);
  cancelledPage.status = 'cancelled';
  cancelledPage.elapsedMs = cancelledPage.startedAt ? Date.now() - cancelledPage.startedAt : cancelledPage.elapsedMs;
  persistReceiptJobs();
  syncProcessingState();
  persistAndRenderCaptures();
  $('#receipt-state').textContent = `Imagen ${index + 1} cancelada. Las demás capturas del mismo lote vuelven a la cola automáticamente.`;
  if (survivorCaptures.length > 0) await startReceiptBackgroundJob(survivorCaptures);
}

async function retryCaptureProcessing(index) {
  const capture = state.captures[index];
  if (!capture) return;
  captureReviewState();
  const key = captureKey(capture);
  detachCaptureFromJobs(key);
  const previous = state.pageStates.get(key) ?? createPageState();
  state.pageStates.set(key, createPageState(previous));
  invalidateAssembledReview();
  persistAndRenderCaptures();
  $('#receipt-state').textContent = `Reintentando la imagen ${index + 1} automáticamente.`;
  await startReceiptBackgroundJob([capture]);
}

async function retryCaptureAi(index) {
  const capture = state.captures[index];
  if (!capture || !state.aiConfigured) return;
  const key = captureKey(capture);
  const page = state.pageStates.get(key);
  if (!page?.rawText || !page.result || pageIsActive(page)) return;
  captureReviewState();
  page.status = 'ai-warning';
  page.aiStatus = 'queued';
  page.aiErrorCode = '';
  persistAndRenderCaptures();
  $('#receipt-state').textContent = `Reintentando sólo la IA para la imagen ${index + 1}; el OCR no se repetirá.`;
  await startReceiptBackgroundJob([capture], { mode: 'ai-retry' });
}

function reviewCaptureEvidence(index) {
  const capture = state.captures[index];
  if (!capture) return;
  const key = captureKey(capture);
  document.dispatchEvent(new CustomEvent('basketra:select-tab', {
    detail: { group: 'tickets', value: 'review' },
  }));
  requestAnimationFrame(() => {
    let item = $(`.receipt-item[data-capture-key="${CSS.escape(key)}"]`);
    if (!item) {
      addBlankLine(key);
      item = $(`.receipt-item[data-capture-key="${CSS.escape(key)}"]`);
    }
    item?.querySelector('[data-receipt-editor]')?.click();
  });
}

function useManualReview(index) {
  const capture = state.captures[index];
  if (!capture) return;
  const key = captureKey(capture);
  const page = state.pageStates.get(key);
  if (!page || page.status !== 'error' || !page.recovery?.allowManualReview) return;
  detachCaptureFromJobs(key);
  page.version += 1;
  page.status = 'manual';
  page.jobId = '';
  page.error = '';
  page.errorCode = '';
  page.recovery = null;
  state.manualReviewRequired = true;
  persistAndRenderCaptures();
  $('#receipt-state').textContent = `Imagen ${index + 1} enviada a revisión manual. El OCR es sólo un borrador: valida todas las líneas y el total antes de confirmar.`;
  void maybeAssembleReceipt();
}

function cancelReceiptExtraction() {
  state.jobGeneration += 1;
  for (const job of activeJobs()) {
    void api(`/api/v1/receipts/extraction-jobs/${encodeURIComponent(job.id)}`, { method: 'DELETE' }).catch(() => {});
    job.status = 'cancelled';
    for (const key of job.captureKeys) {
      const page = state.pageStates.get(key);
      if (!page) continue;
      if (job.mode === 'ai-retry' && page.result) {
        page.status = 'ai-warning';
        page.aiStatus = 'warning';
        page.jobId = '';
        continue;
      }
      if (REVIEWABLE_PAGE_STATUSES.has(page.status)) continue;
      page.status = 'cancelled';
      page.jobId = job.id;
      page.elapsedMs = page.startedAt ? Date.now() - page.startedAt : page.elapsedMs;
      page.error = '';
      page.errorCode = '';
      page.recovery = null;
    }
  }
  state.assemblyController?.abort();
  state.assemblyController = null;
  state.finalizing = false;
  persistReceiptJobs();
  syncProcessingState();
  closeJobRealtimeIfIdle();
  stopReceiptProgress();
  persistAndRenderCaptures();
  $('#receipt-state').textContent = 'Procesamiento cancelado. Las capturas y cualquier OCR completado se conservan.';
}

async function maybeAssembleReceipt() {
  syncProcessingState();
  if (state.processing || state.finalizing || state.captures.length === 0 || state.reviewRefreshBlocked) return;
  const pages = state.captures.map(capture => state.pageStates.get(captureKey(capture)));
  if (pages.every(page => page && REVIEWABLE_PAGE_STATUSES.has(page.status))) {
    await assembleCompletedPages(state.runToken);
    return;
  }
  stopReceiptProgress();
  updateGlobalProgress();
}

async function assembleCompletedPages(token) {
  if (token !== state.runToken || state.finalizing) return;
  state.finalizing = true;
  syncProcessingState();
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
    const hasAiWarnings = state.captures.some(capture => (
      state.pageStates.get(captureKey(capture))?.aiStatus === 'warning'
    ));
    if (hasManualPages) {
      $('#receipt-state').textContent = 'Revisión manual preparada. Corrige cantidades e importes y pulsa “Validar líneas” antes de confirmar.';
    } else if (hasAiWarnings) {
      $('#receipt-state').textContent = 'OCR preparado. Hay avisos de IA, pero las líneas siguen disponibles: revisa manualmente o reintenta la IA desde la captura.';
    } else {
      $('#receipt-state').textContent = articleCount === undefined
        ? 'Procesamiento terminado. Revisa las líneas, cantidades y total antes de confirmar.'
        : `Procesamiento terminado. El ticket indica ${articleCount} artículos; revisa las líneas y el total.`;
    }
  } catch (error) {
    if (error.name !== 'AbortError' && token === state.runToken) {
      $('#receipt-state').textContent = `${error.message}. Las páginas completadas se conservan; se puede volver a preparar la revisión.`;
    }
  } finally {
    if (token === state.runToken) {
      state.finalizing = false;
      state.assemblyController = null;
      syncProcessingState();
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
      ...(previous.captureStorageKey ? { captureStorageKey: previous.captureStorageKey } : {}),
      ...(previous.sourceRegion ? { sourceRegion: previous.sourceRegion } : {}),
      ...(previous.fieldConfidence ? { fieldConfidence: previous.fieldConfidence } : {}),
      ...(previous.manualId ? { manualId: previous.manualId } : {}),
      confidence: 1,
      userConfirmed: true,
    };
  }).sort((left, right) => left.index - right.index).map(({ index, ...item }) => item);
}

function collectCorrections(items) {
  const corrections = [];
  const originalByKey = new Map(state.originalItems.flatMap((item, index) => {
    const key = itemEvidenceKey(item);
    return key ? [[key, { item, index }]] : [];
  }));
  items.forEach((item, itemIndex) => {
    const key = itemEvidenceKey(item);
    const originalEntry = key ? originalByKey.get(key) : undefined;
    const original = originalEntry?.item ?? state.originalItems[itemIndex];
    if (!original) return;
    for (const field of RECEIPT_FIELDS) {
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
    captureReviewState();
    state.manualReviewRequired = false;
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
    REVIEWABLE_PAGE_STATUSES.has(state.pageStates.get(captureKey(capture))?.status)
  ));
}

async function confirmReceipt() {
  syncProcessingState();
  if (!allCapturesCompleted() || state.processing || state.finalizing) {
    $('#receipt-state').textContent = 'Completa, reintenta o retira todas las imágenes antes de confirmar el ticket.';
    return;
  }
  if (state.manualReviewRequired) {
    $('#receipt-state').textContent = 'El OCR manual es sólo un borrador. Pulsa “Validar líneas” y corrige cualquier diferencia antes de confirmar.';
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
    captureReviewState();
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
    clearReceiptExtractionJobs();
    state.captures = [];
    state.pageStates.clear();
    state.extraction = null;
    state.items = [];
    state.originalItems = [];
    state.originalText = '';
    state.processing = false;
    state.manualReviewRequired = false;
    state.progressVisible = false;
    clearPreservedReviewState();
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
  const captureList = $('#capture-list');
  if (captureList && !$('#receipt-progress')) {
    const progress = document.createElement('section');
    progress.id = 'receipt-progress';
    progress.className = 'receipt-progress';
    progress.hidden = true;
    progress.setAttribute('aria-live', 'polite');
    progress.innerHTML = `
      <div class="receipt-progress__heading">
        <strong id="receipt-progress-stage">Procesamiento automático</strong>
        <span id="receipt-progress-elapsed">0 s</span>
      </div>
      <div id="receipt-progress-track" class="receipt-progress__track" role="progressbar" aria-label="Imágenes con OCR disponible" aria-valuetext="Sin iniciar"></div>
      <div class="receipt-progress__meta">
        <span id="receipt-progress-captures">0 imágenes con OCR disponible</span>
        <span id="receipt-progress-detail">El servidor reparte OCR e IA según la capacidad disponible.</span>
      </div>
      <button id="cancel-receipt-extraction" class="button secondary receipt-progress__cancel" type="button">Cancelar todo</button>`;
    captureList.insertAdjacentElement('afterend', progress);
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

function removeLegacyAnalysisStep() {
  const group = document.querySelector('[data-tab-group="tickets"]');
  const tab = group?.querySelector('[role="tab"][data-tab-value="progress"]');
  const panelId = tab?.getAttribute('aria-controls');
  tab?.remove();
  if (panelId) document.getElementById(panelId)?.remove();
  const workflow = $('.receipt-workflow');
  if (workflow && !workflow.contains($('.manual-entry'))) workflow.remove();
  else if (workflow) workflow.hidden = true;
}

function markReceiptFieldEdited(event) {
  const input = event.target.closest?.('[data-field]');
  const fieldset = input?.closest('.receipt-item');
  if (!input || !fieldset) return;
  const index = Number(fieldset.dataset.itemIndex);
  const item = state.items[index];
  const field = INPUT_TO_ITEM_FIELD[input.dataset.field];
  if (!item || !field) return;
  item.userConfirmed = true;
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
  document.addEventListener('input', markReceiptFieldEdited);
  $('#close-capture-preview').addEventListener('click', () => {
    $('#capture-preview-image').removeAttribute('src');
    closeDialog($('#capture-preview-dialog'));
  });
  $('#cancel-receipt-extraction').addEventListener('click', cancelReceiptExtraction);
  $('#review-receipt').addEventListener('click', () => void validateRows());
  $('#confirm-receipt').addEventListener('click', () => void confirmReceipt());
  $('#add-manual-line').addEventListener('click', () => addBlankLine());
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

function prepareStoredJobs() {
  ensurePageStates();
  const captureKeys = new Set(state.captures.map(captureKey));
  for (const [id, job] of state.jobs) {
    job.captureKeys = job.captureKeys.filter(key => captureKeys.has(key));
    if (job.captureKeys.length === 0) state.jobs.delete(id);
  }
  if (state.jobs.size === 0 && state.legacyJobId && state.captures.length > 0) {
    state.jobs.set(state.legacyJobId, {
      id: state.legacyJobId,
      captureKeys: state.captures.map(captureKey),
      status: 'queued',
      mode: 'full',
    });
  }
  state.legacyJobId = '';
  for (const job of state.jobs.values()) {
    for (const key of job.captureKeys) {
      const page = state.pageStates.get(key);
      if (!page) continue;
      if (ACTIVE_JOB_STATUSES.has(job.status)) {
        page.jobId = job.id;
        if (job.mode === 'ai-retry' && page.result) {
          page.status = 'ai-warning';
          page.aiStatus = job.status === 'running' ? 'processing' : 'queued';
        } else if (job.status === 'running') page.status = 'preparing';
        else if (job.status === 'queued') page.status = 'pending';
      }
    }
  }
  persistReceiptJobs();
}

async function restoreReceiptProcessing() {
  prepareStoredJobs();
  persistAndRenderCaptures();
  const jobs = [...state.jobs.values()];
  if (jobs.some(job => ACTIVE_JOB_STATUSES.has(job.status))) {
    syncProcessingState();
    startReceiptProgress();
    ensureJobRealtime();
  }

  state.restoringJobs = true;
  let failedRecovery = false;
  try {
    for (const job of jobs) {
      try {
        await refreshReceiptExtractionJob(job.id);
      } catch {
        failedRecovery = true;
      }
    }
  } finally {
    state.restoringJobs = false;
  }
  if (failedRecovery) {
    $('#receipt-state').textContent = 'No se pudo recuperar todo el procesamiento en segundo plano. Las capturas se conservan y se reintentará al volver a cargar.';
    return;
  }

  const mappedKeys = new Set([...state.jobs.values()].flatMap(job => job.captureKeys));
  const untracked = state.captures.filter(capture => !mappedKeys.has(captureKey(capture)));
  if (untracked.length > 0) {
    captureReviewState();
    invalidateAssembledReview();
    await startReceiptBackgroundJob(untracked);
    return;
  }
  await maybeAssembleReceipt();
}

export function initReceipts(options) {
  metadata = options.metadata;
  toast = options.toast;
  state.aiConfigured = options.aiConfigured === true;
  installReceiptEnhancements();
  removeLegacyAnalysisStep();
  bindEvents();
  ensurePageStates();
  persistAndRenderCaptures();
  $('#upload-state').textContent = state.aiConfigured
    ? 'Añade una captura: el OCR dará resultados primero y la IA verificará después sin bloquearlos.'
    : 'Añade una captura: el OCR local empezará automáticamente.';
  void restoreReceiptProcessing();
}
