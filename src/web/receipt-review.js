import { api, setBusy } from './api.js';
import { euroInputToMinor, formatEuroMinor, minorToEuroInput, receiptReview } from './ui.js';
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

let receiptLineEnhancementsInstalled = false;

function ensureReceiptDiscountStylesheet() {
  if (document.querySelector('link[data-receipt-discount-styles]')) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = '/receipt-discount.css';
  link.dataset.receiptDiscountStyles = 'true';
  document.head.append(link);
}

ensureReceiptDiscountStylesheet();

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

function receiptItemAt(index) {
  return $(`.receipt-item[data-item-index="${index}"]`);
}

function percentageBasisPointsToInput(basisPoints) {
  if (!Number.isSafeInteger(basisPoints) || basisPoints < 0 || basisPoints > 10_000) return '';
  const whole = Math.floor(basisPoints / 100);
  const fraction = basisPoints % 100;
  if (fraction === 0) return String(whole);
  return `${whole}.${String(fraction).padStart(2, '0').replace(/0$/u, '')}`;
}

function percentageInputToBasisPoints(value) {
  const normalized = String(value).trim().replace(',', '.');
  const match = /^(\d{1,3})(?:\.(\d{0,2}))?$/u.exec(normalized);
  if (!match) throw new RangeError('Introduce un porcentaje con hasta dos decimales');
  const basisPoints = Number(match[1]) * 100 + Number((match[2] || '').padEnd(2, '0'));
  if (!Number.isSafeInteger(basisPoints) || basisPoints > 10_000) {
    throw new RangeError('El porcentaje debe estar entre 0 y 100');
  }
  return basisPoints;
}

function normalizedDiscount(item) {
  if (item?.discount?.type === 'amount' && Number.isSafeInteger(item.discount.amountMinor)) {
    return { type: 'amount', amountMinor: item.discount.amountMinor };
  }
  if (item?.discount?.type === 'percentage' && Number.isSafeInteger(item.discount.basisPoints)) {
    return { type: 'percentage', basisPoints: item.discount.basisPoints };
  }
  if (Number.isSafeInteger(item?.discountMinor) && item.discountMinor > 0) {
    return { type: 'amount', amountMinor: item.discountMinor };
  }
  return undefined;
}

function discountEditorValue(item) {
  const discount = normalizedDiscount(item);
  if (!discount) return { type: 'none', value: '' };
  if (discount.type === 'amount') return { type: 'amount', value: minorToEuroInput(discount.amountMinor) };
  return { type: 'percentage', value: percentageBasisPointsToInput(discount.basisPoints) };
}

function upgradeReceiptTotal(fieldset) {
  const current = fieldset.querySelector('[data-field="lineTotalEuro"]');
  if (!current || current instanceof HTMLOutputElement) return current;
  const label = current.closest('label');
  if (!label) return current;

  const result = document.createElement('div');
  result.className = 'receipt-line-result';
  const caption = document.createElement('span');
  caption.className = 'receipt-line-result__label';
  caption.textContent = 'Total';
  const value = document.createElement('span');
  value.className = 'receipt-line-result__value';
  const output = document.createElement('output');
  output.dataset.field = 'lineTotalEuro';
  output.value = current.value;
  output.setAttribute('aria-label', 'Total calculado (€)');
  const currency = document.createElement('span');
  currency.setAttribute('aria-hidden', 'true');
  currency.textContent = '€';
  value.append(output, currency);
  result.append(caption, value);
  label.replaceWith(result);
  return output;
}

function addReceiptDiscountFields(fieldset, item) {
  if (fieldset.querySelector('[data-field="discountType"]')) return;
  const quantityRow = fieldset.querySelector('.quantity-row');
  if (!quantityRow) return;
  const total = upgradeReceiptTotal(fieldset);
  const totalContainer = total?.closest('.receipt-line-result');
  const initial = discountEditorValue(item);

  const typeLabel = document.createElement('label');
  typeLabel.className = 'field receipt-discount-type-field';
  const typeCaption = document.createElement('span');
  typeCaption.textContent = 'Descuento';
  const select = document.createElement('select');
  select.dataset.field = 'discountType';
  select.setAttribute('aria-label', 'Tipo de descuento');
  for (const [value, label] of [
    ['none', 'Sin descuento'],
    ['percentage', 'Porcentaje'],
    ['amount', 'Importe (€)'],
  ]) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    select.append(option);
  }
  select.value = initial.type;
  typeLabel.append(typeCaption, select);

  const valueLabel = document.createElement('label');
  valueLabel.className = 'field receipt-discount-value-field';
  const valueCaption = document.createElement('span');
  valueCaption.dataset.discountValueLabel = 'true';
  const input = document.createElement('input');
  input.type = 'text';
  input.inputMode = 'decimal';
  input.autocomplete = 'off';
  input.dataset.field = 'discountValue';
  input.value = initial.value;
  valueLabel.append(valueCaption, input);

  if (totalContainer) {
    quantityRow.insertBefore(typeLabel, totalContainer);
    quantityRow.insertBefore(valueLabel, totalContainer);
  } else {
    quantityRow.append(typeLabel, valueLabel);
  }
  syncDiscountValueControl(fieldset);
  rememberDiscountEditorValue(fieldset);
}

function syncDiscountValueControl(fieldset) {
  const type = fieldset?.querySelector('[data-field="discountType"]');
  const value = fieldset?.querySelector('[data-field="discountValue"]');
  const label = value?.closest('.receipt-discount-value-field');
  const caption = label?.querySelector('[data-discount-value-label]');
  if (!(type instanceof HTMLSelectElement) || !(value instanceof HTMLInputElement) || !label || !caption) return;

  const disabled = type.value === 'none';
  label.hidden = disabled;
  value.disabled = disabled;
  if (disabled) {
    value.value = '';
    value.removeAttribute('aria-label');
    return;
  }
  const percentage = type.value === 'percentage';
  const labelText = percentage ? 'Descuento (%)' : 'Descuento (€)';
  caption.textContent = labelText;
  value.setAttribute('aria-label', labelText);
}

function discountFromFields(fieldset) {
  const type = fieldset.querySelector('[data-field="discountType"]');
  const value = fieldset.querySelector('[data-field="discountValue"]');
  if (!(type instanceof HTMLSelectElement) || type.value === 'none') return undefined;
  if (!(value instanceof HTMLInputElement) || !value.value.trim()) {
    throw new RangeError('Completa el valor del descuento');
  }
  if (type.value === 'amount') {
    return { type: 'amount', amountMinor: euroInputToMinor(value.value) };
  }
  if (type.value === 'percentage') {
    return { type: 'percentage', basisPoints: percentageInputToBasisPoints(value.value) };
  }
  throw new RangeError('Selecciona un tipo de descuento válido');
}

function formatDiscount(discount) {
  if (discount?.type === 'amount') return formatEuroMinor(discount.amountMinor);
  if (discount?.type === 'percentage') return `${percentageBasisPointsToInput(discount.basisPoints)}%`;
  return '';
}

function syncReceiptDiscountSummary(fieldset) {
  if (!(fieldset instanceof HTMLElement)) return;
  const copy = fieldset.querySelector('.receipt-line-compact__copy');
  if (!copy) return;
  let discount;
  try {
    discount = discountFromFields(fieldset);
  } catch {
    discount = undefined;
  }

  let summary = copy.querySelector('[data-receipt-discount-summary]');
  if (!discount) {
    summary?.remove();
    return;
  }
  if (!summary) {
    summary = document.createElement('small');
    summary.dataset.receiptDiscountSummary = 'true';
    copy.append(summary);
  }
  summary.textContent = `Dto. ${formatDiscount(discount)}`;
}

function syncReceiptDiscountSummaries() {
  $$('.receipt-item').forEach(syncReceiptDiscountSummary);
}

function scheduleReceiptDiscountSummaries() {
  queueMicrotask(() => queueMicrotask(syncReceiptDiscountSummaries));
}

function rememberDiscountEditorValue(fieldset) {
  const type = fieldset?.querySelector('[data-field="discountType"]');
  const value = fieldset?.querySelector('[data-field="discountValue"]');
  if (!(type instanceof HTMLSelectElement) || !(value instanceof HTMLInputElement)) return;
  fieldset.dataset.receiptEditorInitialDiscountType = type.value;
  fieldset.dataset.receiptEditorInitialDiscountValue = value.value;
}

function scheduleDiscountEditorRestore(dialog) {
  const fieldset = dialog.querySelector('.receipt-item');
  if (!fieldset) return;
  const index = Number(fieldset.dataset.itemIndex);
  const originalType = fieldset.dataset.receiptEditorInitialDiscountType ?? 'none';
  const originalValue = fieldset.dataset.receiptEditorInitialDiscountValue ?? '';
  queueMicrotask(() => {
    const restored = receiptItemAt(index);
    const type = restored?.querySelector('[data-field="discountType"]');
    const value = restored?.querySelector('[data-field="discountValue"]');
    if (!(type instanceof HTMLSelectElement) || !(value instanceof HTMLInputElement)) return;
    type.value = originalType;
    value.value = originalValue;
    syncDiscountValueControl(restored);
    syncReceiptDiscountSummary(restored);
  });
}

function installReceiptLineEnhancements() {
  if (receiptLineEnhancementsInstalled) return;
  receiptLineEnhancementsInstalled = true;

  document.addEventListener('input', event => {
    const fieldset = event.target.closest?.('.receipt-item');
    if (fieldset) queueMicrotask(() => syncReceiptDiscountSummary(fieldset));
  });
  document.addEventListener('change', event => {
    if (event.target?.dataset?.field !== 'discountType') return;
    const fieldset = event.target.closest('.receipt-item');
    if (!fieldset) return;
    queueMicrotask(() => {
      syncDiscountValueControl(fieldset);
      syncReceiptDiscountSummary(fieldset);
    });
  });

  document.addEventListener('click', event => {
    const fieldset = event.target.closest?.('[data-receipt-action="edit"], .receipt-line-compact')
      ?.closest('[data-swipe-row]')?.querySelector('.receipt-item');
    if (fieldset) rememberDiscountEditorValue(fieldset);
  }, true);

  const dialog = $('#receipt-line-dialog');
  if (!dialog) return;
  dialog.addEventListener('click', event => {
    if (!event.target.closest('#cancel-receipt-line-editor, #close-receipt-line-editor')) return;
    scheduleDiscountEditorRestore(dialog);
  }, true);
  dialog.addEventListener('cancel', () => scheduleDiscountEditorRestore(dialog), true);
}

function renderUnassignedDiscountNotice() {
  const review = $('#receipt-review');
  if (!review) return;
  review.querySelector('[data-unassigned-discounts]')?.remove();
  const discounts = state.extraction?.final?.unassignedDiscounts;
  if (!Array.isArray(discounts) || discounts.length === 0) return;

  const notice = document.createElement('div');
  notice.className = 'receipt-discount-review-warning';
  notice.dataset.unassignedDiscounts = 'true';
  notice.setAttribute('role', 'status');
  const strong = document.createElement('strong');
  strong.textContent = discounts.length === 1
    ? 'Hay un descuento pendiente de asignar'
    : `Hay ${discounts.length} descuentos pendientes de asignar`;
  const list = document.createElement('ul');
  for (const entry of discounts) {
    const item = document.createElement('li');
    const description = entry.description ? ` · ${entry.description}` : '';
    const source = Array.isArray(entry.sourceLines) ? ` · líneas OCR ${entry.sourceLines.join(', ')}` : '';
    item.textContent = `${formatDiscount(entry.discount)}${description}${source}: ${entry.reason}`;
    list.append(item);
  }
  notice.append(strong, list);
  review.querySelector('.review-summary')?.insertAdjacentElement('afterend', notice);
}

function enhanceReceiptLines(lines) {
  installReceiptLineEnhancements();
  state.items.forEach((item, index) => {
    const fieldset = receiptItemAt(index);
    if (!fieldset) return;
    upgradeReceiptTotal(fieldset);
    addReceiptDiscountFields(fieldset, item);
    const validation = lines[index] || {};
    if (validation.status === 'confirmed') return;
    const status = fieldset.querySelector('.receipt-item__legend-actions .status-pill');
    if (!status || status.matches('[data-receipt-action="validate"]')) return;
    const action = document.createElement('button');
    action.type = 'button';
    action.className = 'status-pill warning';
    action.dataset.receiptAction = 'validate';
    action.dataset.receiptIndex = String(index);
    action.dataset.receiptValidation = 'review';
    action.setAttribute('aria-label', `Validar línea ${index + 1}`);
    action.title = 'Validar esta línea';
    action.textContent = 'Revisar';
    status.replaceWith(action);
  });
  renderUnassignedDiscountNotice();
  scheduleReceiptDiscountSummaries();
}

export function renderReview(lines = [], total) {
  const review = $('#receipt-review');
  review.hidden = false;
  review.innerHTML = receiptReview(state.items, lines, total);
  enhanceReceiptLines(lines);
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
    // Removing a row must remain possible while another row has an incomplete discount or euro value.
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

function lineValidationMessage(validation, item, index, suffix = 'antes de importar') {
  const lineLabel = `Línea ${index + 1}`;
  if (validation?.status === 'confirmed') return `${lineLabel} validada.`;
  if (validation?.status === 'unreadable') {
    return `${lineLabel}: indica una descripción legible ${suffix}.`;
  }
  if (validation?.status === 'arithmetic-mismatch') {
    const expected = Number.isSafeInteger(validation.expectedMinor) ? formatEuroMinor(validation.expectedMinor) : 'el importe calculado';
    const entered = Number.isSafeInteger(item?.lineTotalMinor) ? formatEuroMinor(item.lineTotalMinor) : 'el total indicado';
    return `${lineLabel}: el total esperado es ${expected} y el ticket indica ${entered}. Revisa cantidad, precio unitario o descuento ${suffix}.`;
  }
  return `${lineLabel}: revisa y valida esta línea ${suffix}.`;
}

function firstInvalidLine(validation) {
  const lines = Array.isArray(validation?.lines) ? validation.lines : [];
  const index = lines.findIndex(entry => entry?.validation?.status !== 'confirmed');
  return index < 0 ? null : { index, validation: lines[index]?.validation || {} };
}

function focusInvalidLine(index) {
  const focus = () => {
    const action = $(`[data-receipt-action="validate"][data-receipt-index="${index}"]`);
    action?.scrollIntoView({ block: 'center', behavior: 'auto' });
    action?.focus();
  };
  requestAnimationFrame(focus);
}

export async function validateReceiptLine(index, button) {
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
    renderReview(items.map((_, lineIndex) => validation.lines[lineIndex]?.validation || {}), validation.total);
    const current = validation.lines[index]?.validation || {};
    $('#receipt-state').textContent = lineValidationMessage(current, items[index], index);
    if (current.status !== 'confirmed') focusInvalidLine(index);
  } catch (error) {
    $('#receipt-state').textContent = `No se pudo validar la línea ${index + 1}: ${error.message}`;
    focusInvalidLine(index);
  } finally {
    setBusy(button, false);
  }
}

export function handleReceiptAction(event) {
  const button = event.target.closest('[data-receipt-action]');
  if (!button) return;
  const action = button.dataset.receiptAction;
  if (action === 'add-line') addBlankLine();
  if (action === 'delete') deleteReceiptLine(Number(button.dataset.receiptIndex));
  if (action === 'validate') void validateReceiptLine(Number(button.dataset.receiptIndex), button);
  if (action === 'edit') {
    const row = button.closest('[data-swipe-row]')?.querySelector('.receipt-item');
    rememberDiscountEditorValue(row);
    row?.querySelector('[data-field="description"]')?.focus();
  }
}

export function readReceiptItems() {
  return $$('.receipt-item').map(fieldset => {
    const index = Number(fieldset.dataset.itemIndex);
    const previous = state.items[index] || {};
    const discount = discountFromFields(fieldset);
    return {
      index,
      description: fieldset.querySelector('[data-field="description"]').value.trim(),
      quantity: Number(fieldset.querySelector('[data-field="quantity"]').value),
      unitPriceMinor: euroInputToMinor(fieldset.querySelector('[data-field="unitPriceEuro"]').value),
      lineTotalMinor: euroInputToMinor(fieldset.querySelector('[data-field="lineTotalEuro"]').value),
      ...(discount ? { discount } : {}),
      ...(previous.taxCategory ? { taxCategory: previous.taxCategory } : {}),
      ...(previous.sourceLines ? { sourceLines: previous.sourceLines } : {}),
      confidence: 1,
      userConfirmed: true,
    };
  }).sort((left, right) => left.index - right.index).map(({ index, ...item }) => item);
}

function discountsEqual(left, right) {
  return JSON.stringify(normalizedDiscount(left) ?? null) === JSON.stringify(normalizedDiscount(right) ?? null);
}

export function collectCorrections(items) {
  const corrections = [];
  items.forEach((item, itemIndex) => {
    const original = state.originalItems[itemIndex];
    if (!original) {
      if (item.discount) corrections.push({ itemIndex, field: 'discount', original: null, corrected: item.discount });
      return;
    }
    for (const field of ['description', 'quantity', 'unitPriceMinor', 'lineTotalMinor']) {
      if (item[field] !== original[field]) {
        corrections.push({ itemIndex, field, original: original[field], corrected: item[field] });
      }
    }
    if (!discountsEqual(item, original)) {
      corrections.push({
        itemIndex,
        field: 'discount',
        original: normalizedDiscount(original) ?? null,
        corrected: normalizedDiscount(item) ?? null,
      });
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
    const invalid = firstInvalidLine(validation);
    if (invalid) {
      $('#receipt-state').textContent = lineValidationMessage(invalid.validation, items[invalid.index], invalid.index);
      focusInvalidLine(invalid.index);
      return;
    }
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
    state.manualReviewRequired = false;
    renderReview(items.map((_, index) => validation.lines[index]?.validation || {}), validation.total);
    const invalid = firstInvalidLine(validation);
    if (invalid) {
      $('#receipt-state').textContent = lineValidationMessage(invalid.validation, items[invalid.index], invalid.index);
      focusInvalidLine(invalid.index);
      return;
    }
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
