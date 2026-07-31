import { api, setBusy } from './api.js';
import { loadCaptures, saveCaptures } from './state.js';
import { captureItem, euroInputToMinor, minorToEuroInput, receiptReview } from './ui.js';

const state = {
  captures: loadCaptures(),
  extraction: null,
  items: [],
  originalItems: [],
  originalText: '',
  controller: null,
  aiConfigured: false,
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

function invalidateExtraction() {
  state.controller?.abort();
  state.extraction = null;
  state.items = [];
  state.originalItems = [];
  state.originalText = '';
  $('#receipt-review').hidden = true;
  $('#confirm-receipt').hidden = true;
  $('#receipt-state').textContent = '';
}

function persistAndRenderCaptures() {
  saveCaptures(state.captures);
  $('#capture-list').innerHTML = state.captures
    .map((capture, index) => captureItem(capture, index, state.captures.length))
    .join('');
  $('#extract-receipt').disabled = state.captures.length === 0;
  $('#capture-list').querySelectorAll('img[data-capture-preview-image]').forEach(image => {
    image.addEventListener('error', () => {
      image.hidden = true;
      image.nextElementSibling.hidden = false;
    }, { once: true });
  });
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
      invalidateExtraction();
      persistAndRenderCaptures();
    }
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
  const target = index + direction;
  if (!state.captures[index] || !state.captures[target]) return;
  [state.captures[index], state.captures[target]] = [state.captures[target], state.captures[index]];
  invalidateExtraction();
  persistAndRenderCaptures();
}

function deleteCapture(index) {
  if (!state.captures[index]) return;
  state.captures.splice(index, 1);
  invalidateExtraction();
  persistAndRenderCaptures();
  $('#upload-state').textContent = 'Captura retirada del borrador; la evidencia original se conserva';
}

function handleCaptureAction(event) {
  const button = event.target.closest('[data-capture-action]');
  if (!button) return;
  const index = Number(button.dataset.captureIndex);
  if (button.dataset.captureAction === 'preview') showPreview(index);
  if (button.dataset.captureAction === 'up') moveCapture(index, -1);
  if (button.dataset.captureAction === 'down') moveCapture(index, 1);
  if (button.dataset.captureAction === 'delete') deleteCapture(index);
}

function captureRequests() {
  return state.captures.map(capture => ({
    storageKey: capture.storageKey,
    originalName: capture.name,
  }));
}

async function requestExtraction(verifyWithAi, signal) {
  return api('/api/v1/receipts/extract', {
    method: 'POST',
    body: JSON.stringify({ captures: captureRequests(), verifyWithAi }),
    signal,
  });
}

function renderReview(lines = [], total) {
  $('#receipt-review').hidden = false;
  $('#receipt-review').innerHTML = receiptReview(state.items, lines, total);
  $('#confirm-receipt').hidden = state.items.length === 0;
}

function applyExtraction(extraction) {
  state.extraction = extraction;
  state.items = extraction.final.items.map(item => ({ ...item }));
  state.originalItems = extraction.final.items.map(item => ({ ...item }));
  state.originalText = extraction.originalText || '';
  if (extraction.final.declaredTotalMinor !== undefined) {
    $('#receipt-total').value = minorToEuroInput(extraction.final.declaredTotalMinor);
  }
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

async function processReceipt() {
  if (state.captures.length === 0) {
    $('#receipt-state').textContent = 'Añade al menos una captura antes de procesar.';
    $('#receipt-camera').focus();
    return;
  }
  state.controller?.abort();
  const controller = new AbortController();
  state.controller = controller;
  const button = $('#extract-receipt');
  setBusy(button, true);
  $('#receipt-state').textContent = 'Leyendo el ticket con OCR local…';
  const verifyWithAi = state.aiConfigured && $('#verify-receipt-ai').checked;
  try {
    let result;
    try {
      result = await requestExtraction(verifyWithAi, controller.signal);
    } catch (error) {
      if (error.name === 'AbortError') throw error;
      if (!verifyWithAi || String(error.code || '').startsWith('OCR_')) throw error;
      $('#receipt-state').textContent = 'La verificación IA falló; conservando el OCR local…';
      result = await requestExtraction(false, controller.signal);
    }
    if (controller.signal.aborted) return;
    applyExtraction(result.extraction);
    $('#receipt-state').textContent = verifyWithAi
      ? 'OCR local y verificación listos para corregir.'
      : 'OCR local listo para corregir y confirmar.';
  } catch (error) {
    if (error.name === 'AbortError') return;
    $('.manual-entry').open = true;
    if (state.items.length === 0) addBlankLine();
    if (error.code === 'AI_NOT_CONFIGURED' && state.captures.some(capture => capture.mimeType === 'application/pdf')) {
      $('#receipt-state').textContent = 'El OCR local admite imágenes. Para este PDF configura un proveedor compatible o añade las líneas manualmente.';
      return;
    }
    $('#receipt-state').textContent = `${error.message}. Puedes corregir o añadir las líneas manualmente; el borrador se conserva.`;
  } finally {
    setBusy(button, false);
  }
}

function readReceiptItems() {
  return $$('.receipt-item').map(fieldset => ({
    index: Number(fieldset.dataset.itemIndex),
    description: fieldset.querySelector('[data-field="description"]').value.trim(),
    quantity: Number(fieldset.querySelector('[data-field="quantity"]').value),
    unitPriceMinor: euroInputToMinor(fieldset.querySelector('[data-field="unitPriceEuro"]').value),
    lineTotalMinor: euroInputToMinor(fieldset.querySelector('[data-field="lineTotalEuro"]').value),
    confidence: 1,
    userConfirmed: true,
  })).sort((left, right) => left.index - right.index).map(({ index, ...item }) => item);
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

function providerLabel() {
  const sources = new Set((state.extraction?.pages || []).map(page => page.source));
  if (state.extraction?.ai) sources.add('ai-verification');
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

async function confirmReceipt() {
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
    const result = await api('/api/v1/receipts/confirm', {
      method: 'POST',
      body: JSON.stringify({
        importKey: await createImportKey(originalText),
        originalText,
        declaredTotalMinor,
        provider: providerLabel(),
        deterministic: state.extraction?.deterministic || { items },
        ...(state.extraction?.ai ? { ai: state.extraction.ai.interpretation } : {}),
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
    state.captures = [];
    state.extraction = null;
    state.items = [];
    state.originalItems = [];
    state.originalText = '';
    persistAndRenderCaptures();
    $('#receipt-review').hidden = true;
    $('#confirm-receipt').hidden = true;
    $('#receipt-total').value = '0.00';
  } catch (error) {
    $('#receipt-state').textContent = `Revisa el ticket: ${error.message}. El borrador se conserva.`;
  } finally {
    setBusy(button, false);
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
  $('#extract-receipt').addEventListener('click', () => void processReceipt());
  $('#review-receipt').addEventListener('click', () => void validateRows());
  $('#confirm-receipt').addEventListener('click', () => void confirmReceipt());
  $('#add-manual-line').addEventListener('click', addBlankLine);
  document.addEventListener('basketra:swipe-action', event => {
    if (event.detail?.kind !== 'receipt-line' || event.detail?.action !== 'delete') return;
    deleteReceiptLine(Number(event.detail.id));
  });
}

export function initReceipts(options) {
  metadata = options.metadata;
  toast = options.toast;
  state.aiConfigured = options.aiConfigured === true;
  const aiToggle = $('#verify-receipt-ai');
  aiToggle.checked = false;
  aiToggle.disabled = !state.aiConfigured;
  $('#receipt-ai-help').textContent = state.aiConfigured
    ? 'Opcional: revisa el texto local con tu proveedor configurado.'
    : 'OCR local en español activo; no necesita cuenta ni conexión externa.';
  bindEvents();
  persistAndRenderCaptures();
}
