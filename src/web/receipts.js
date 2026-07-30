import { api, setBusy } from './api.js';
import { loadCaptures, saveCaptures } from './state.js';
import { captureItem, receiptReview } from './ui.js';

const state = {
  captures: loadCaptures(),
  extraction: null,
  originalItems: [],
  controller: null,
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
  state.originalItems = [];
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

function captureRequests(manualText) {
  return state.captures.map((capture, index) => ({
    storageKey: capture.storageKey,
    originalName: capture.name,
    ...(manualText && index === 0 ? { embeddedText: manualText } : {}),
  }));
}

async function requestExtraction(manualText, verifyWithAi, signal) {
  return api('/api/v1/receipts/extract', {
    method: 'POST',
    body: JSON.stringify({ captures: captureRequests(manualText), verifyWithAi }),
    signal,
  });
}

async function processReceipt({ manualOnly = false } = {}) {
  if (state.captures.length === 0) {
    $('#receipt-state').textContent = 'Añade al menos una captura antes de procesar.';
    $('#receipt-camera').focus();
    return;
  }
  const manualText = $('#receipt-text').value.trim();
  if (manualOnly && !manualText) {
    $('#receipt-state').textContent = 'Añade una transcripción antes de revisar manualmente.';
    $('#receipt-text').focus();
    return;
  }

  state.controller?.abort();
  const controller = new AbortController();
  state.controller = controller;
  const button = manualOnly ? $('#review-receipt') : $('#extract-receipt');
  setBusy(button, true);
  $('#receipt-state').textContent = manualOnly ? 'Validando transcripción…' : 'Procesando capturas…';
  try {
    const verifyWithAi = !manualOnly && $('#verify-receipt-ai').checked;
    let result;
    try {
      result = await requestExtraction(manualText, verifyWithAi, controller.signal);
    } catch (error) {
      if (error.name === 'AbortError') throw error;
      if (!manualText || !verifyWithAi) throw error;
      $('#receipt-state').textContent = 'La IA no está disponible; continuando con validación local…';
      result = await requestExtraction(manualText, false, controller.signal);
    }
    if (controller.signal.aborted) return;
    applyExtraction(result.extraction);
    $('#receipt-state').textContent = 'Extracción lista para corregir y confirmar';
  } catch (error) {
    if (error.name === 'AbortError') return;
    if (!manualText && error.code === 'AI_NOT_CONFIGURED') {
      $('.manual-entry').open = true;
      $('#receipt-state').textContent = 'No hay OCR configurado. Transcribe el ticket y pulsa “Revisar transcripción”.';
      $('#receipt-text').focus();
      return;
    }
    $('#receipt-state').textContent = `No se pudo procesar: ${error.message}. El borrador se conserva.`;
  } finally {
    setBusy(button, false);
  }
}

function applyExtraction(extraction) {
  state.extraction = extraction;
  state.originalItems = extraction.final.items.map(item => ({ ...item }));
  if (extraction.originalText) $('#receipt-text').value = extraction.originalText;
  if (extraction.final.declaredTotalMinor !== undefined) $('#receipt-total').value = String(extraction.final.declaredTotalMinor);
  $('.manual-entry').open = true;
  renderReview(extraction.final.items, extraction.final.review.lines, extraction.final.review.total);
}

function renderReview(items, lines, total) {
  $('#receipt-review').hidden = false;
  $('#receipt-review').innerHTML = receiptReview(items, lines, total);
  $('#confirm-receipt').hidden = items.length === 0;
}

function readReceiptItems() {
  return $$('.receipt-item').map(fieldset => ({
    index: Number(fieldset.dataset.itemIndex),
    description: fieldset.querySelector('[data-field="description"]').value.trim(),
    quantity: Number(fieldset.querySelector('[data-field="quantity"]').value),
    unitPriceMinor: Number(fieldset.querySelector('[data-field="unitPriceMinor"]').value),
    lineTotalMinor: Number(fieldset.querySelector('[data-field="lineTotalMinor"]').value),
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

async function createImportKey(originalText) {
  const source = `${state.captures.map(capture => capture.storageKey).join('|')}|${originalText}`;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(source));
  return `receipt-${[...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('')}`;
}

async function confirmReceipt() {
  const items = readReceiptItems();
  if (items.length === 0) {
    $('#receipt-state').textContent = 'No hay líneas para importar.';
    return;
  }
  const declaredTotalMinor = Number($('#receipt-total').value);
  const originalText = $('#receipt-text').value.trim();
  const button = $('#confirm-receipt');
  setBusy(button, true);
  $('#receipt-state').textContent = 'Validando ticket…';
  try {
    const validation = await api('/api/v1/receipts/validate', {
      method: 'POST',
      body: JSON.stringify({ declaredTotalMinor, items }),
    });
    renderReview(items, validation.lines.map(line => line.validation), validation.total);
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
    state.originalItems = [];
    persistAndRenderCaptures();
    $('#receipt-review').hidden = true;
    $('#confirm-receipt').hidden = true;
    $('#receipt-text').value = '';
    $('#receipt-total').value = '0';
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
  $('#close-capture-preview').addEventListener('click', () => {
    $('#capture-preview-image').removeAttribute('src');
    closeDialog($('#capture-preview-dialog'));
  });
  $('#extract-receipt').addEventListener('click', () => void processReceipt());
  $('#review-receipt').addEventListener('click', () => void processReceipt({ manualOnly: true }));
  $('#confirm-receipt').addEventListener('click', () => void confirmReceipt());
}

export function initReceipts(options) {
  metadata = options.metadata;
  toast = options.toast;
  bindEvents();
  persistAndRenderCaptures();
}
