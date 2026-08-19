import {
  $,
  closeDialog,
  configureReceiptContext,
  ensurePageStates,
  state,
} from './receipt-state.js';
import {
  handleCaptureAction,
  persistAndRenderCaptures,
  uploadFiles,
} from './receipt-capture.js';
import {
  refreshReceiptExtractionJob,
  startAutomaticCaptureProcessing,
  watchReceiptExtractionJob,
} from './receipt-lifecycle.js';
import { cancelReceiptExtraction } from './receipt-processing.js';
import {
  addBlankLine,
  confirmReceipt,
  deleteReceiptLine,
  handleReceiptAction,
  hideRetailerSuggestions,
  renderReviewReference,
  scheduleRetailerSuggestions,
  selectRetailerSuggestion,
  validateRows,
} from './receipt-review.js';

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
    <button id="cancel-receipt-extraction" class="button secondary receipt-progress__cancel" type="button">Cancelar procesamiento</button>`;
  return progress;
}

export function installReceiptEnhancements() {
  installReceiptStylesheet();
  const captureSource = $('.capture-source');
  const workflow = $('.receipt-workflow');
  const manualEntry = $('.manual-entry');
  const review = $('#receipt-review');
  const confirm = $('#confirm-receipt');
  const receiptState = $('#receipt-state');
  const aiSwitch = workflow?.querySelector('.switch-row');
  if (!captureSource || !workflow || !manualEntry || !review || !confirm || !receiptState || !aiSwitch) return;

  const captureHeading = captureSource.querySelector('.panel-heading');
  if (captureHeading) {
    captureHeading.replaceChildren();
    const headingCopy = document.createElement('div');
    const heading = document.createElement('h2');
    heading.textContent = 'Capturas';
    const help = document.createElement('p');
    help.className = 'field-help';
    help.textContent = 'Añade fotos o PDF. El OCR empieza automáticamente al guardar cada lote.';
    headingCopy.append(heading, help);
    captureHeading.append(headingCopy);
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

  if (!$('#receipt-progress')) captureSource.append(createReceiptProgressPanel());
  captureSource.append(receiptState);

  if (!$('#receipt-review-panel')) {
    const panel = document.createElement('details');
    panel.id = 'receipt-review-panel';
    panel.className = 'receipt-review-panel';
    panel.hidden = true;

    const summary = document.createElement('summary');
    const summaryCopy = document.createElement('span');
    const title = document.createElement('strong');
    title.textContent = 'Revisión del ticket';
    const help = document.createElement('small');
    help.textContent = 'Captura original y filas editables en el mismo contexto';
    summaryCopy.append(title, help);
    summary.append(summaryCopy);

    const body = document.createElement('div');
    body.className = 'receipt-review-panel__body';
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
    editor.append(manualEntry, review, confirm);
    body.append(evidence, editor);
    panel.append(summary, body);
    workflow.replaceChildren(panel);
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

export function bindEvents() {
  for (const input of [$('#receipt-files'), $('#receipt-camera')]) {
    input.addEventListener('change', async event => {
      await uploadFiles(event.target.files);
      event.target.value = '';
    });
  }
  $('#capture-list').addEventListener('click', handleCaptureAction);
  $('#receipt-review').addEventListener('click', handleReceiptAction);
  $('#receipt-review-capture').addEventListener('change', event => {
    state.selectedReviewCaptureKey = event.target.value;
    renderReviewReference();
  });
  $('#close-capture-preview').addEventListener('click', () => {
    $('#capture-preview-image').removeAttribute('src');
    closeDialog($('#capture-preview-dialog'));
  });
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
  configureReceiptContext(options);
  installReceiptEnhancements();
  const aiToggle = $('#verify-receipt-ai');
  aiToggle.checked = state.aiConfigured;
  aiToggle.disabled = !state.aiConfigured;
  $('#receipt-ai-help').textContent = state.aiConfigured
    ? 'Opcional y no bloqueante en fotos: primero conservamos el OCR local y la IA sólo intenta corregirlo. Los PDF usan el proveedor para leer el documento; cualquier fallo conserva la captura y permite revisión manual.'
    : 'OCR local en español activo para fotos. Los PDF quedan disponibles para revisión manual sin proveedor de IA.';
  bindEvents();
  ensurePageStates();
  persistAndRenderCaptures();
  if (state.activeJobId) {
    watchReceiptExtractionJob();
    void refreshReceiptExtractionJob().catch(() => {
      $('#receipt-state').textContent = 'No se pudo recuperar el análisis anterior. Las capturas se conservan y puedes continuar con OCR local.';
    });
  } else if (state.captures.length > 0) {
    startAutomaticCaptureProcessing(state.captures);
  }
}
