import { api, setBusy } from './api.js';
import { euroInputToMinor, minorToEuroInput, receiptReview } from './ui.js';
import {
  REVIEWABLE_PAGE_STATUSES,
  $,
  $$,
  captureByKey,
  captureKey,
  state,
  toast,
} from './receipt-state.js';
import { persistAndRenderCaptures } from './receipt-capture.js';
import { abortPageWork, clearReceiptExtractionJob } from './receipt-lifecycle.js';
export function selectedReviewCapture() {
  return captureByKey(state.selectedReviewCaptureKey) || state.captures[0] || null;
}

export function renderReviewReference() {
  const container = $('#receipt-review-reference');
  const selector = $('#receipt-review-capture');
  if (!container || !selector) return;

  selector.replaceChildren();
  for (const [index, capture] of state.captures.entries()) {
    const option = document.createElement('option');
    option.value = captureKey(capture);
    option.textContent = `Imagen ${index + 1}: ${capture.name}`;
    selector.append(option);
  }

  const capture = selectedReviewCapture();
  if (!capture) {
    container.replaceChildren();
    return;
  }
  state.selectedReviewCaptureKey = captureKey(capture);
  selector.value = state.selectedReviewCaptureKey;
  container.replaceChildren();

  if (capture.mimeType.startsWith('image/')) {
    const image = document.createElement('img');
    image.id = 'receipt-review-reference-image';
    image.src = `/api/v1/files/${encodeURIComponent(capture.storageKey)}`;
    image.alt = `Captura de referencia: ${capture.name}`;
    image.loading = 'lazy';
    container.append(image);
    return;
  }

  const documentReference = document.createElement('div');
  documentReference.className = 'receipt-review-reference__document';
  documentReference.setAttribute('role', 'img');
  documentReference.setAttribute('aria-label', `Documento PDF de referencia: ${capture.name}`);
  const strong = document.createElement('strong');
  strong.textContent = capture.name;
  const small = document.createElement('small');
  small.textContent = 'PDF conservado como evidencia original';
  documentReference.append(strong, small);
  container.append(documentReference);
}

export function showReviewPanelForCapture(index) {
  const capture = state.captures[index];
  if (capture) state.selectedReviewCaptureKey = captureKey(capture);
  const panel = $('#receipt-review-panel');
  if (!panel) return;
  panel.hidden = false;
  panel.open = true;
  renderReviewReference();
  panel.scrollIntoView({ block: 'start', behavior: 'auto' });
}

export function renderReview(lines = [], total) {
  const review = $('#receipt-review');
  review.hidden = false;
  review.innerHTML = receiptReview(state.items, lines, total);
  $('#confirm-receipt').hidden = state.items.length === 0;
  const panel = $('#receipt-review-panel');
  if (panel) {
    panel.hidden = false;
    panel.open = true;
  }
  renderReviewReference();
}

export function applyExtraction(extraction, originalText = extraction.originalText || '') {
  state.extraction = extraction;
  state.items = extraction.final.items.map(item => ({ ...item }));
  state.originalItems = extraction.final.items.map(item => ({ ...item }));
  state.originalText = originalText;
  if (!state.selectedReviewCaptureKey && state.captures[0]) {
    state.selectedReviewCaptureKey = captureKey(state.captures[0]);
  }
  if (extraction.final.declaredTotalMinor !== undefined) {
    $('#receipt-total').value = minorToEuroInput(extraction.final.declaredTotalMinor);
  }
  applyRetailerCandidate(extraction.final.retailerName || extraction.ai?.interpretation?.retailerName);
  renderReview(extraction.final.review.lines, extraction.final.review.total);
}

export function addBlankLine() {
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

export function restoreReceiptLine(index, item, original) {
  state.items.splice(Math.min(index, state.items.length), 0, item);
  if (original) state.originalItems.splice(Math.min(index, state.originalItems.length), 0, original);
  renderReview();
  $('#receipt-state').textContent = 'Línea restaurada; revisa el total antes de confirmar.';
  toast('Línea restaurada');
}

export function deleteReceiptLine(index, { undoable = true } = {}) {
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

export function handleReceiptAction(event) {
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

export function readReceiptItems() {
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

export function collectCorrections(items) {
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

export function pageAiEvidence() {
  return state.captures.flatMap((capture, position) => {
    const page = state.pageStates.get(captureKey(capture));
    const interpretation = page?.result?.ai?.interpretation;
    return interpretation ? [{ position, interpretation }] : [];
  });
}

export function providerLabel() {
  const sources = new Set();
  for (const capture of state.captures) {
    const page = state.pageStates.get(captureKey(capture));
    const source = page?.result?.pages?.[0]?.source;
    if (source) sources.add(source === 'embedded-text' ? 'local-tesseract' : source);
    if (page?.result?.ai) sources.add('ai-verification');
  }
  return [...sources].join('+') || 'manual';
}

export function serializeManualItems(items) {
  return items.map(item => [
    item.description,
    item.quantity,
    minorToEuroInput(item.unitPriceMinor),
    minorToEuroInput(item.lineTotalMinor),
  ].join(';')).join('\n');
}

export async function createImportKey(originalText) {
  const source = `${state.captures.map(capture => capture.storageKey).join('|')}|${originalText}`;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(source));
  return `receipt-${[...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('')}`;
}

export async function validateRows() {
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

export function normalizeRetailerName(name) {
  return String(name || '').replace(/\s+/gu, ' ').trim();
}

export function setRetailerValue(value) {
  state.settingRetailerValue = true;
  $('#receipt-retailer').value = value;
  state.settingRetailerValue = false;
}

export function applyRetailerCandidate(name) {
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

export function hideRetailerSuggestions() {
  const suggestions = $('#retailer-suggestions');
  suggestions.hidden = true;
  suggestions.replaceChildren();
  $('#receipt-retailer').setAttribute('aria-expanded', 'false');
}

export function renderRetailerSuggestions(suggestions) {
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

export function renderDetectedRetailerChoices(candidates) {
  const container = $('#retailer-suggestions');
  container.replaceChildren();
  for (const candidate of candidates) appendRetailerOption(container, candidate, 'Detectado en una imagen');
  container.hidden = false;
  $('#receipt-retailer').setAttribute('aria-expanded', 'true');
}

export function appendRetailerOption(container, retailerName, detail) {
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

export function scheduleRetailerSuggestions() {
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

export function selectRetailerSuggestion(event) {
  const option = event.target.closest('[data-retailer-name]');
  if (!option) return;
  setRetailerValue(option.dataset.retailerName);
  state.retailerManuallyEdited = true;
  hideRetailerSuggestions();
  $('#receipt-retailer').focus();
}

export function allCapturesCompleted() {
  return state.captures.length > 0 && state.captures.every(capture => (
    REVIEWABLE_PAGE_STATUSES.has(state.pageStates.get(captureKey(capture))?.status)
  ));
}

export async function confirmReceipt() {
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
    clearReceiptExtractionJob();
    state.pageStates.clear();
    state.extraction = null;
    state.items = [];
    state.originalItems = [];
    state.originalText = '';
    state.processing = false;
    state.manualReviewRequired = false;
    state.progressVisible = false;
    persistAndRenderCaptures();
    $('#receipt-progress').hidden = true;
    $('#receipt-review').hidden = true;
    $('#confirm-receipt').hidden = true;
    $('#receipt-review-panel').hidden = true;
    $('#receipt-review-panel').open = false;
    $('#receipt-total').value = '0.00';
    state.selectedReviewCaptureKey = '';
    state.expandedCaptureKey = '';
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
