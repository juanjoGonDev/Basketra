import { api } from './api.js';
import {
  $,
  $$,
  closeDialog,
  configureReceiptContext,
  ensurePageStates,
  state,
} from './receipt-state.js';
import {
  handleCaptureAction,
  persistAndRenderCaptures,
  refreshReceiptAiLimitHelp,
  showPreview,
  uploadFiles,
} from './receipt-capture.js';
import {
  captureRequest,
  refreshReceiptExtractionJob,
  startAutomaticCaptureProcessing,
  watchReceiptExtractionJob,
} from './receipt-lifecycle.js';
import { cancelReceiptExtraction } from './receipt-processing.js';
import { saveReceiptExtractionJobId } from './state.js';
import { icon } from './ui.js';
import {
  addBlankLine,
  confirmReceipt,
  deleteReceiptLine,
  handleReceiptAction,
  hideRetailerSuggestions,
  renderReviewReference,
  scheduleRetailerSuggestions,
  selectRetailerSuggestion,
  selectedReviewCapture,
  validateRows,
} from './receipt-review.js';

const MOBILE_REVIEW_MEDIA = '(max-width: 49.99rem)';
const SOFTWARE_KEYBOARD_SETTLE_MS = 280;
const RECEIPT_EXTRACTION_JOB_ID_PATTERN = /^receiptextractionjob_[a-z0-9]+$/iu;
let reviewReferenceObserver;
let reviewSummaryObserver;

export function installReceiptStylesheet() {
  if (document.querySelector('link[data-receipt-review-styles]')) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = '/receipt-review.css';
  link.dataset.receiptReviewStyles = 'true';
  document.head.append(link);
}

export function createReceiptProgressPanel() {
  const progress = document.createElement('section');
  progress.id = 'receipt-progress';
  progress.className = 'receipt-progress receipt-progress--compact';
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
    </div>`;
  return progress;
}

export function syncCompactReviewEvidence() {
  const expand = $('#receipt-review-expand');
  const capture = selectedReviewCapture();
  if (!expand || !capture) {
    if (expand) expand.hidden = true;
    return;
  }

  expand.hidden = !capture.mimeType.startsWith('image/');
  expand.setAttribute('aria-label', `Ampliar captura ${capture.name}`);
}

export function syncStickyReviewSummary() {
  const sticky = $('#receipt-review-sticky-summary');
  const review = $('#receipt-review');
  const confirm = $('#confirm-receipt');
  const expand = $('#receipt-review-expand');
  if (!sticky || !review || !confirm) return;

  const total = review.querySelector('.review-total') || sticky.querySelector('.review-total');
  const status = review.querySelector('.review-summary .status-pill') || sticky.querySelector('.status-pill');
  const summaryMeta = $('#receipt-review-summary-meta');
  if (!total || !status) {
    sticky.hidden = true;
    sticky.replaceChildren(...[expand, confirm].filter(Boolean));
    if (summaryMeta) summaryMeta.textContent = 'Pendiente';
    return;
  }

  if (summaryMeta) {
    const amount = total.querySelector('strong')?.textContent?.trim() || '';
    const label = status.textContent?.trim() || '';
    summaryMeta.textContent = [amount, label].filter(Boolean).join(' · ');
  }

  if (!status.querySelector('.icon')) {
    const statusIcon = status.classList.contains('warning') ? 'alert' : 'check';
    status.insertAdjacentHTML('afterbegin', icon(statusIcon));
  }

  sticky.hidden = false;
  sticky.replaceChildren(...[expand, total, status, confirm].filter(Boolean));
  syncCompactReviewEvidence();
}

export function installReviewContextObservers() {
  const reference = $('#receipt-review-reference');
  const review = $('#receipt-review');
  if (!reviewReferenceObserver && reference) {
    reviewReferenceObserver = new MutationObserver(syncCompactReviewEvidence);
    reviewReferenceObserver.observe(reference, { childList: true });
  }
  if (!reviewSummaryObserver && review) {
    reviewSummaryObserver = new MutationObserver(syncStickyReviewSummary);
    reviewSummaryObserver.observe(review, { childList: true });
  }
  syncCompactReviewEvidence();
  syncStickyReviewSummary();
}

export function keepMobileReviewFocusVisible(target) {
  requestAnimationFrame(() => {
    const targetRect = target.getBoundingClientRect();
    const summaryRect = $('#receipt-review-sticky-summary').getBoundingClientRect();
    const navigationRect = $('.bottom-nav').getBoundingClientRect();
    const visualViewport = window.visualViewport;
    const viewportBottom = visualViewport
      ? visualViewport.offsetTop + visualViewport.height
      : window.innerHeight;
    const visibleTop = summaryRect.bottom + 8;
    const visibleBottom = Math.min(navigationRect.top, viewportBottom) - 8;
    const targetCenter = targetRect.top + targetRect.height / 2;
    const visibleCenter = (visibleTop + visibleBottom) / 2;
    window.scrollBy({ top: targetCenter - visibleCenter, left: 0, behavior: 'auto' });
  });
}

export function installReceiptEnhancements() {
  installReceiptStylesheet();
  const scanView = document.querySelector('.view[data-view="scan"]');
  const pageHeader = scanView?.querySelector('.page-header');
  const captureSource = $('.capture-source');
  const workflow = $('.receipt-workflow');
  const manualEntry = $('.manual-entry');
  const review = $('#receipt-review');
  const confirm = $('#confirm-receipt');
  const receiptState = $('#receipt-state');
  const aiSwitch = workflow?.querySelector('.switch-row') || captureSource?.querySelector('.switch-row');
  if (!scanView || !pageHeader || !captureSource || !workflow || !manualEntry || !review || !confirm || !receiptState || !aiSwitch) return;

  pageHeader.classList.add('receipt-analysis-header');
  const eyebrow = pageHeader.querySelector('.eyebrow');
  const heading = pageHeader.querySelector('h1');
  const intro = pageHeader.querySelector('p:not(.eyebrow)');
  if (eyebrow) eyebrow.textContent = 'Tickets';
  if (heading) heading.textContent = 'Análisis de ticket';
  if (intro) intro.textContent = 'Los productos aparecen mientras se procesa cada página. Revisa el resultado antes de importar.';

  if (!confirm.querySelector('.confirm-receipt__label-expanded')) {
    confirm.innerHTML = `${icon('check')}<span class="confirm-receipt__label-expanded">Confirmar e importar</span><span class="confirm-receipt__label-compact">Validar</span>`;
  }

  aiSwitch.querySelector('strong').textContent = 'Corregir OCR con IA';
  const aiInput = aiSwitch.querySelector('#verify-receipt-ai');
  aiInput.setAttribute('aria-label', 'Corregir OCR con IA');

  if (!$('#receipt-analysis-options')) {
    const analysisOptions = document.createElement('details');
    analysisOptions.id = 'receipt-analysis-options';
    analysisOptions.className = 'receipt-analysis-options';
    const summary = document.createElement('summary');
    const summaryTitle = document.createElement('strong');
    summaryTitle.textContent = 'Opciones de análisis';
    const summaryHelp = document.createElement('small');
    summaryHelp.textContent = 'La IA es opcional y nunca bloquea el OCR';
    summary.append(summaryTitle, summaryHelp);
    const body = document.createElement('div');
    body.className = 'details-body';
    body.append(aiSwitch);
    analysisOptions.append(summary, body);
    captureSource.insertBefore(analysisOptions, captureSource.querySelector('.capture-actions'));
  }

  if (!$('#receipt-source-queue')) {
    const queue = document.createElement('details');
    queue.id = 'receipt-source-queue';
    queue.className = 'receipt-source-queue';

    const queueSummary = document.createElement('summary');
    queueSummary.innerHTML = `
      ${icon('receipt')}
      <span class="receipt-source-queue__summary-copy">
        <strong>Archivos</strong>
        <small id="receipt-source-queue-summary">0 archivos</small>
      </span>
      <span class="receipt-source-queue__status-dot" aria-hidden="true"></span>`;

    const queuePanel = document.createElement('div');
    queuePanel.className = 'receipt-source-queue__panel';
    const queueHeader = document.createElement('header');
    queueHeader.className = 'receipt-source-queue__header';
    const queueHeading = document.createElement('div');
    const queueTitle = document.createElement('strong');
    queueTitle.textContent = 'Archivos del análisis';
    const queueHelp = document.createElement('small');
    queueHelp.id = 'receipt-source-queue-detail';
    queueHelp.textContent = 'Añade imágenes o PDF con el botón +';
    queueHeading.append(queueTitle, queueHelp);

    const cancelAll = document.createElement('button');
    cancelAll.id = 'cancel-receipt-extraction';
    cancelAll.className = 'icon-button danger receipt-source-queue__cancel';
    cancelAll.type = 'button';
    cancelAll.disabled = true;
    cancelAll.setAttribute('aria-label', 'Cancelar todo el análisis');
    cancelAll.title = 'Cancelar todo el análisis';
    cancelAll.innerHTML = icon('close');

    const queueBody = document.createElement('div');
    queueBody.className = 'receipt-source-queue__body';
    queueHeader.append(queueHeading, cancelAll);
    queuePanel.append(queueHeader, queueBody);
    queue.append(queueSummary, queuePanel);
    pageHeader.append(queue);
    queueBody.append(captureSource);
  }

  const captureHeading = captureSource.querySelector('.panel-heading');
  if (captureHeading) captureHeading.hidden = true;

  let progress = $('#receipt-progress');
  if (!progress) progress = createReceiptProgressPanel();
  if (progress.parentElement !== scanView) pageHeader.insertAdjacentElement('afterend', progress);

  receiptState.classList.add('receipt-analysis-status');
  if (receiptState.parentElement !== scanView) progress.insertAdjacentElement('afterend', receiptState);

  if (!$('#receipt-detected-stream')) {
    const detected = document.createElement('section');
    detected.id = 'receipt-detected-stream';
    detected.className = 'receipt-detected-stream';
    detected.setAttribute('aria-labelledby', 'receipt-detected-title');
    detected.innerHTML = `
      <div class="receipt-detected-stream__header">
        <div>
          <p class="eyebrow">En directo</p>
          <h2 id="receipt-detected-title">Productos detectados</h2>
        </div>
        <span id="receipt-detected-count" class="count-badge">0</span>
      </div>
      <p id="receipt-detected-help" class="receipt-detected-stream__help">Las líneas son provisionales hasta completar la revisión conjunta.</p>
      <ol id="receipt-detected-list" class="receipt-detected-list"></ol>
      <p id="receipt-detected-empty" class="receipt-detected-empty">Añade un ticket con +. Los productos aparecerán aquí a medida que se detecten.</p>`;
    receiptState.insertAdjacentElement('afterend', detected);
  }

  if (!$('#receipt-review-panel')) {
    const panel = document.createElement('details');
    panel.id = 'receipt-review-panel';
    panel.className = 'receipt-review-panel';
    panel.hidden = true;

    const summary = document.createElement('summary');
    const summaryCopy = document.createElement('span');
    const title = document.createElement('strong');
    title.textContent = 'Vista previa y validación';
    const help = document.createElement('small');
    help.textContent = 'Revisa captura, líneas e importes antes de importar';
    summaryCopy.append(title, help);
    const summaryMeta = document.createElement('span');
    summaryMeta.id = 'receipt-review-summary-meta';
    summaryMeta.className = 'receipt-review-panel__summary-meta';
    summaryMeta.textContent = 'Pendiente';
    summary.append(summaryCopy, summaryMeta);

    const body = document.createElement('div');
    body.className = 'receipt-review-panel__body';

    const stickySummary = document.createElement('div');
    stickySummary.id = 'receipt-review-sticky-summary';
    stickySummary.className = 'receipt-review-sticky-summary';
    stickySummary.hidden = true;

    const expand = document.createElement('button');
    expand.id = 'receipt-review-expand';
    expand.className = 'icon-button receipt-review-expand';
    expand.type = 'button';
    expand.hidden = true;
    expand.setAttribute('aria-label', 'Ampliar captura');
    expand.innerHTML = icon('image');
    stickySummary.append(expand, confirm);

    const evidence = document.createElement('aside');
    evidence.className = 'receipt-review-evidence';
    evidence.innerHTML = `
      <label class="field" for="receipt-review-capture">
        <span>Captura de referencia</span>
        <select id="receipt-review-capture"></select>
      </label>
      <div id="receipt-review-reference" class="receipt-review-reference" aria-live="polite"></div>`;

    const editor = document.createElement('div');
    editor.className = 'receipt-review-editor';
    manualEntry.open = false;
    manualEntry.querySelector('summary').textContent = 'Datos, total y acciones manuales';
    review.className = 'receipt-review-content';
    editor.append(manualEntry, review);
    body.append(stickySummary, evidence, editor);
    panel.append(summary, body);
    workflow.replaceChildren(panel);
  }

  const reviewEditor = $('.receipt-review-editor');
  if (reviewEditor && !$('#receipt-retailer')) {
    const storeFields = document.createElement('fieldset');
    storeFields.className = 'flow-group receipt-store-fields';
    storeFields.innerHTML = `
      <legend>Comercio y tienda</legend>
      <label class="field" for="receipt-retailer">
        <span>Comercio</span>
        <input id="receipt-retailer" required maxlength="120" autocomplete="organization" placeholder="Ej. ALCAMPO" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="retailer-suggestions">
      </label>
      <label id="receipt-detected-store" class="field" for="receipt-store">
        <span>Tienda</span>
        <input id="receipt-store" required maxlength="160" autocomplete="organization" placeholder="Ej. ALCAMPO ALMERIA" list="receipt-store-options" aria-describedby="receipt-store-help">
        <small id="receipt-store-help">La tienda es obligatoria. La IA puede proponerla; elige una guardada o escribe una nueva para crearla al confirmar.</small>
      </label>
      <datalist id="receipt-store-options"></datalist>
      <div id="retailer-suggestions" class="retailer-suggestions" role="listbox" aria-label="Comercios guardados o detectados" hidden></div>`;
    reviewEditor.prepend(storeFields);
  }

  if (!$('#receipt-add-trigger')) {
    const filesInput = $('#receipt-files');
    const cameraInput = $('#receipt-camera');
    const legacyActions = captureSource.querySelector('.capture-actions');

    const menu = document.createElement('div');
    menu.id = 'receipt-add-menu';
    menu.className = 'receipt-add-menu';
    menu.hidden = true;
    menu.setAttribute('aria-label', 'Opciones para añadir al ticket');

    const aiAction = document.createElement('label');
    aiAction.className = 'receipt-add-action';
    aiAction.dataset.receiptCaptureMode = 'ai';
    aiAction.innerHTML = `${icon('sparkles')}<span><strong>IA</strong><small>Imagen o PDF</small></span>`;
    if (filesInput) aiAction.append(filesInput);

    const manualAction = document.createElement('button');
    manualAction.id = 'receipt-add-manual';
    manualAction.className = 'receipt-add-action';
    manualAction.type = 'button';
    manualAction.innerHTML = `${icon('edit')}<span><strong>Manual</strong><small>Añadir una línea</small></span>`;

    const scanAction = document.createElement('label');
    scanAction.className = 'receipt-add-action';
    scanAction.dataset.receiptCaptureMode = 'scan';
    scanAction.innerHTML = `${icon('camera')}<span><strong>Scan</strong><small>Foto → IA/OCR</small></span>`;
    if (cameraInput) scanAction.append(cameraInput);

    menu.append(aiAction, manualAction, scanAction);

    const analysisOptions = $('#receipt-analysis-options');
    if (analysisOptions?.parentElement === captureSource) captureSource.append(analysisOptions);

    const trigger = document.createElement('button');
    trigger.id = 'receipt-add-trigger';
    trigger.className = 'receipt-add-trigger';
    trigger.type = 'button';
    trigger.setAttribute('aria-label', 'Añadir al ticket');
    trigger.setAttribute('aria-expanded', 'false');
    trigger.setAttribute('aria-controls', 'receipt-add-menu');
    trigger.innerHTML = icon('plus');

    scanView.append(menu, trigger);
    legacyActions?.remove();
  }

  installReviewContextObservers();
}

async function refreshReceiptStoreOptions() {
  const options = $('#receipt-store-options');
  if (!options) return;
  const retailer = $('#receipt-retailer')?.value.trim() || '';
  options.replaceChildren();
  if (!retailer) return;
  try {
    const result = await api(`/api/v1/inventory/stores?retailer=${encodeURIComponent(retailer)}&sort=name&limit=100&offset=0`);
    if (($('#receipt-retailer')?.value.trim() || '') !== retailer) return;
    for (const store of result.stores || []) {
      if (store.retailerName?.toLocaleLowerCase('es-ES') !== retailer.toLocaleLowerCase('es-ES')) continue;
      const option = document.createElement('option');
      option.value = store.name;
      option.label = store.name;
      options.append(option);
    }
  } catch {
    options.replaceChildren();
  }
}

function setReceiptAddMenuOpen(open) {
  const menu = $('#receipt-add-menu');
  const trigger = $('#receipt-add-trigger');
  if (!menu || !trigger) return;
  menu.hidden = !open;
  trigger.setAttribute('aria-expanded', String(open));
  trigger.classList.toggle('is-open', open);
}

function prepareAiAssistedCapture() {
  const aiToggle = $('#verify-receipt-ai');
  if (aiToggle) aiToggle.checked = state.aiConfigured;
  if (!state.aiConfigured) {
    $('#receipt-state').textContent = 'IA no disponible. La captura continuará con OCR local y podrás revisarla manualmente.';
  }
  setReceiptAddMenuOpen(false);
}

export function bindEvents() {
  for (const input of [$('#receipt-files'), $('#receipt-camera')]) {
    input.addEventListener('change', async event => {
      await uploadFiles(event.target.files);
      event.target.value = '';
      setReceiptAddMenuOpen(false);
    });
  }

  $('#receipt-add-trigger')?.addEventListener('click', () => {
    setReceiptAddMenuOpen($('#receipt-add-menu')?.hidden === true);
  });
  $$('[data-receipt-capture-mode]').forEach(action => {
    action.addEventListener('click', prepareAiAssistedCapture);
  });
  $('#receipt-add-manual')?.addEventListener('click', () => {
    setReceiptAddMenuOpen(false);
    const panel = $('#receipt-review-panel');
    if (panel) {
      panel.hidden = false;
      panel.open = true;
    }
    addBlankLine();
  });

  document.addEventListener('pointerdown', event => {
    const queue = $('#receipt-source-queue');
    const menu = $('#receipt-add-menu');
    const trigger = $('#receipt-add-trigger');
    if (queue?.open && !queue.contains(event.target)) queue.open = false;
    if (menu && !menu.hidden && !menu.contains(event.target) && !trigger?.contains(event.target)) {
      setReceiptAddMenuOpen(false);
    }
  });
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    const queue = $('#receipt-source-queue');
    if (queue?.open) queue.open = false;
    setReceiptAddMenuOpen(false);
  });
  document.addEventListener('basketra:view-changed', event => {
    if (event.detail?.view === 'scan') return;
    const queue = $('#receipt-source-queue');
    if (queue?.open) queue.open = false;
    setReceiptAddMenuOpen(false);
  });

  $('#capture-list').addEventListener('click', handleCaptureAction);
  $('#receipt-review').addEventListener('click', handleReceiptAction);
  $('#receipt-review-capture').addEventListener('change', event => {
    state.selectedReviewCaptureKey = event.target.value;
    renderReviewReference();
  });
  $('#receipt-review-expand')?.addEventListener('click', () => {
    showPreview(state.captures.indexOf(selectedReviewCapture()));
  });
  $('#receipt-review-panel').addEventListener('focusin', event => {
    if (!window.matchMedia(MOBILE_REVIEW_MEDIA).matches) return;
    if (!event.target.matches('input, select, textarea')) return;
    keepMobileReviewFocusVisible(event.target);
    window.setTimeout(() => keepMobileReviewFocusVisible(event.target), SOFTWARE_KEYBOARD_SETTLE_MS);
  });
  $('#close-capture-preview').addEventListener('click', () => {
    $('#capture-preview-image').removeAttribute('src');
    closeDialog($('#capture-preview-dialog'));
  });
  $('#cancel-receipt-extraction').addEventListener('click', cancelReceiptExtraction);
  $('#review-receipt').addEventListener('click', () => void validateRows());
  $('#confirm-receipt').addEventListener('click', () => void confirmReceipt());
  $('#add-manual-line').addEventListener('click', addBlankLine);
  $('#receipt-retailer').addEventListener('input', event => {
    scheduleRetailerSuggestions(event);
    void refreshReceiptStoreOptions();
  });
  $('#receipt-retailer').addEventListener('change', () => void refreshReceiptStoreOptions());
  $('#receipt-retailer').addEventListener('keydown', event => {
    if (event.key === 'Escape') hideRetailerSuggestions();
  });
  $('#receipt-retailer').addEventListener('blur', () => setTimeout(hideRetailerSuggestions, 120));
  $('#retailer-suggestions').addEventListener('click', event => {
    selectRetailerSuggestion(event);
    void refreshReceiptStoreOptions();
  });
  $('#receipt-store').addEventListener('input', () => {
    const value = $('#receipt-store').value.trim();
    if (value !== state.detectedStoreName) state.detectedStoreId = '';
    state.detectedStoreName = value;
    state.detectedStoreRetailerName = $('#receipt-retailer').value.trim();
  });
  document.addEventListener('basketra:swipe-action', event => {
    if (event.detail?.kind !== 'receipt-line' || event.detail?.action !== 'delete') return;
    deleteReceiptLine(Number(event.detail.id));
  });
}

async function recoverPersistedReceiptDraft() {
  $('#receipt-state').textContent = 'Comprobando si estas capturas ya tienen un análisis durable...';
  let recovered;
  try {
    recovered = await api('/api/v1/receipts/extraction-jobs/recover', {
      method: 'POST',
      body: JSON.stringify({
        captures: state.captures.map(capture => captureRequest(capture)),
      }),
    });
  } catch {
    $('#receipt-state').textContent = 'No se pudo comprobar el trabajo durable existente. No se iniciará otro OCR ni otra IA para evitar duplicados.';
    return;
  }

  const job = recovered?.job;
  if (!job) {
    startAutomaticCaptureProcessing(state.captures);
    return;
  }
  if (typeof job.id !== 'string' || !RECEIPT_EXTRACTION_JOB_ID_PATTERN.test(job.id)) {
    $('#receipt-state').textContent = 'El servidor devolvió una identidad durable inválida. No se iniciará trabajo nuevo para evitar duplicados.';
    return;
  }

  state.activeJobId = job.id;
  state.failedBackgroundJobId = '';
  state.verifyWithAi = true;
  saveReceiptExtractionJobId(job.id);
  watchReceiptExtractionJob();
  try {
    await refreshReceiptExtractionJob();
  } catch {
    $('#receipt-state').textContent = 'Se recuperó la identidad del análisis, pero no pudo leerse su estado. El job se conserva y no se duplicará.';
  }
}

export function initReceipts(options) {
  configureReceiptContext(options);
  installReceiptEnhancements();
  const aiToggle = $('#verify-receipt-ai');
  aiToggle.checked = state.aiConfigured;
  aiToggle.disabled = !state.aiConfigured;
  $('#receipt-ai-help').textContent = state.aiConfigured
    ? 'Opcional y no bloqueante en fotos: primero conservamos el OCR local y la IA sólo intenta corregirlo. Los PDF usan el proveedor para leer el documento; cualquier fallo conserva la captura y permite revisión manual.'
    : 'OCR local en español activo para fotos. Los PDF quedan disponibles para revisión manual sin proveedor de IA.';
  if (state.aiConfigured) void refreshReceiptAiLimitHelp();
  bindEvents();
  ensurePageStates();
  persistAndRenderCaptures();
  if (state.activeJobId) {
    watchReceiptExtractionJob();
    void refreshReceiptExtractionJob().catch(() => {
      $('#receipt-state').textContent = 'No se pudo recuperar el análisis anterior. Las capturas se conservan y el job conocido no se reemplaza automáticamente.';
    });
  } else if (state.captures.length > 0) {
    void recoverPersistedReceiptDraft();
  }
}
