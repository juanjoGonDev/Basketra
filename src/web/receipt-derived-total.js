import { api } from './api.js';
import { euroInputToMinor, minorToEuroInput } from './ui.js';

const RECEIPT_CALCULATION_DELAY_MS = 120;
const RECEIPT_CALCULATION_PATH = '/api/v1/receipts/calculate-line';
const DRIVER_FIELDS = new Set(['quantity', 'unitPriceEuro', 'discountEuro']);
const calculationState = new WeakMap();
let initialized = false;

function injectStylesheet() {
  if (document.querySelector('link[href="/receipt-derived-total.css"]')) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = '/receipt-derived-total.css';
  document.head.append(link);
}

function receiptLineRoot(element) {
  return element.closest('.receipt-item, [data-receipt-line-editor]');
}

function receiptLineField(root, field) {
  return root?.querySelector(`[data-field="${field}"]`);
}

function receiptCalculationStatus(root, message) {
  const status = root?.querySelector('.receipt-line-derived-state');
  if (status) status.textContent = message;
}

function stateFor(root) {
  let state = calculationState.get(root);
  if (state) return state;
  state = { controller: null, timer: null, version: 0 };
  calculationState.set(root, state);
  return state;
}

function markDerivedTotal(root) {
  const total = receiptLineField(root, 'lineTotalEuro');
  if (!(total instanceof HTMLInputElement)) return undefined;
  total.readOnly = true;
  total.setAttribute('aria-readonly', 'true');
  total.dataset.derivedTotal = 'true';
  return total;
}

function readCalculationInput(root) {
  const quantityInput = receiptLineField(root, 'quantity');
  const unitPriceInput = receiptLineField(root, 'unitPriceEuro');
  const discountInput = receiptLineField(root, 'discountEuro');
  if (!(quantityInput instanceof HTMLInputElement) || !(unitPriceInput instanceof HTMLInputElement)) return undefined;
  const quantity = Number(quantityInput.value);
  if (!Number.isSafeInteger(quantity) || quantity < 0) return undefined;
  try {
    return {
      quantity,
      unitPriceMinor: euroInputToMinor(unitPriceInput.value),
      ...(discountInput instanceof HTMLInputElement && discountInput.value.trim()
        ? { discountMinor: euroInputToMinor(discountInput.value) }
        : {}),
    };
  } catch {
    return undefined;
  }
}

async function calculateReceiptLine(root) {
  const input = readCalculationInput(root);
  const total = markDerivedTotal(root);
  if (!input || !total) return;
  const state = stateFor(root);
  state.controller?.abort();
  const controller = new AbortController();
  state.controller = controller;
  const version = ++state.version;
  total.setAttribute('aria-busy', 'true');
  receiptCalculationStatus(root, 'Calculando total…');
  try {
    const result = await api(RECEIPT_CALCULATION_PATH, {
      method: 'POST',
      signal: controller.signal,
      body: JSON.stringify(input),
    });
    if (version !== state.version || !root.isConnected) return;
    total.value = minorToEuroInput(result.lineTotalMinor);
    total.dispatchEvent(new Event('input', { bubbles: true }));
    receiptCalculationStatus(root, 'Total actualizado.');
  } catch (error) {
    if (error?.name === 'AbortError' || version !== state.version) return;
    receiptCalculationStatus(root, `No se pudo calcular el total: ${error.message}`);
  } finally {
    if (version === state.version) total.setAttribute('aria-busy', 'false');
  }
}

function scheduleReceiptLineCalculation(root, immediate = false) {
  if (!root) return;
  const total = markDerivedTotal(root);
  if (!total) return;
  const state = stateFor(root);
  clearTimeout(state.timer);
  state.controller?.abort();
  const input = readCalculationInput(root);
  if (!input) {
    total.setAttribute('aria-busy', 'false');
    receiptCalculationStatus(root, 'Completa cantidad, precio y descuento para calcular el total.');
    return;
  }
  state.timer = setTimeout(() => void calculateReceiptLine(root), immediate ? 0 : RECEIPT_CALCULATION_DELAY_MS);
}

function enhanceReceiptLine(root) {
  const total = markDerivedTotal(root);
  if (!total || root.querySelector('.receipt-line-derived-state')) return;
  const label = total.closest('label');
  if (!label) return;
  const status = document.createElement('small');
  status.className = 'receipt-line-derived-state field-help';
  status.setAttribute('aria-live', 'polite');
  status.textContent = 'Se actualiza al cambiar cantidad, precio o descuento.';
  label.append(status);
}

function enhanceExisting(root) {
  root.querySelectorAll?.('.receipt-item, [data-receipt-line-editor]').forEach(enhanceReceiptLine);
}

export function initializeReceiptDerivedTotals() {
  if (initialized) return;
  initialized = true;
  injectStylesheet();
  enhanceExisting(document);

  const observer = new MutationObserver(records => {
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (!(node instanceof Element)) continue;
        if (node.matches('.receipt-item, [data-receipt-line-editor]')) enhanceReceiptLine(node);
        enhanceExisting(node);
      }
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });

  document.addEventListener('input', event => {
    if (!DRIVER_FIELDS.has(event.target?.dataset?.field)) return;
    scheduleReceiptLineCalculation(receiptLineRoot(event.target));
  }, true);
  document.addEventListener('change', event => {
    if (!DRIVER_FIELDS.has(event.target?.dataset?.field)) return;
    scheduleReceiptLineCalculation(receiptLineRoot(event.target), true);
  }, true);
}
