export const DEFAULT_REQUEST_THROTTLE_MS = 1000;

const PARALLEL_POST_PATHS = new Set([
  '/api/v1/receipts/extract',
  '/api/v1/receipts/calculate-line',
]);
const UNTHROTTLED_PATHS = new Set([
  '/api/v1/receipts/calculate-line',
]);
const RECEIPT_CALCULATION_DELAY_MS = 120;
const RECEIPT_CALCULATION_PATH = '/api/v1/receipts/calculate-line';
const RECEIPT_CALCULATION_DRIVER_FIELDS = new Set(['quantity', 'unitPriceEuro', 'discountType', 'discountValue']);
const RECEIPT_CALCULATION_ACTION_SELECTOR = '#save-receipt-line-editor, [data-receipt-action="validate"], #review-receipt, #confirm-receipt';
const receiptCalculationState = new WeakMap();
let receiptDerivedTotalsInitialized = false;

function defaultBaseUrl() {
  return globalThis.location?.origin || 'http://localhost';
}

function requestMethod(input, init = {}) {
  return String(init.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
}

function requestUrl(input, baseUrl) {
  return new URL(input instanceof Request ? input.url : String(input), baseUrl);
}

function abortError() {
  return new DOMException('Request was aborted', 'AbortError');
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : abortError();
}

function defaultWait(milliseconds, signal) {
  if (milliseconds <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    let timer;
    const cleanup = () => signal?.removeEventListener('abort', onAbort);
    const onAbort = () => {
      clearTimeout(timer);
      cleanup();
      reject(signal?.reason instanceof Error ? signal.reason : abortError());
    };
    timer = setTimeout(() => {
      cleanup();
      resolve();
    }, milliseconds);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function normalizedHeaderIdentity(headers) {
  if (!headers) return '';
  const normalized = [...new Headers(headers).entries()]
    .map(([name, value]) => `${name.toLowerCase()}:${value}`)
    .sort();
  return normalized.join('|');
}

function readIdentity(input, init, baseUrl) {
  const url = requestUrl(input, baseUrl);
  return [
    requestMethod(input, init),
    url.href,
    normalizedHeaderIdentity(init.headers),
    init.credentials || '',
    init.cache || '',
    init.mode || '',
    init.redirect || '',
    init.referrerPolicy || '',
  ].join(' ');
}

function isCoalescibleRead(input, init) {
  const method = requestMethod(input, init);
  return (method === 'GET' || method === 'HEAD')
    && init.body === undefined
    && init.signal === undefined;
}

function isSerializedMutation(input, init, baseUrl) {
  const method = requestMethod(input, init);
  if (method === 'GET' || method === 'HEAD') return false;
  if (method === 'POST' && PARALLEL_POST_PATHS.has(requestUrl(input, baseUrl).pathname)) return false;
  return true;
}

export function requestBucketKey(input, init = {}, baseUrl = defaultBaseUrl()) {
  const url = requestUrl(input, baseUrl);
  return `${requestMethod(input, init)} ${url.pathname}`;
}

export function createRequestCoordinator({
  baseUrl = defaultBaseUrl(),
  fetchImpl = globalThis.fetch.bind(globalThis),
  now = () => Date.now(),
  wait = defaultWait,
  throttleMs = DEFAULT_REQUEST_THROTTLE_MS,
} = {}) {
  if (!Number.isFinite(throttleMs) || throttleMs < 0) {
    throw new RangeError('Request throttle must be a non-negative finite number');
  }

  const buckets = new Map();
  const inFlightReads = new Map();

  const getBucket = (bucketKey) => {
    let bucket = buckets.get(bucketKey);
    if (bucket) return bucket;
    bucket = {
      lastStartedAt: Number.NEGATIVE_INFINITY,
      startTail: Promise.resolve(),
      mutationTail: Promise.resolve(),
    };
    buckets.set(bucketKey, bucket);
    return bucket;
  };

  const scheduleStart = (bucket, signal) => {
    const previousStart = bucket.startTail.catch(() => undefined);
    const start = previousStart.then(async () => {
      throwIfAborted(signal);
      const elapsed = now() - bucket.lastStartedAt;
      const delay = Number.isFinite(bucket.lastStartedAt)
        ? Math.max(0, throttleMs - elapsed)
        : 0;
      if (delay > 0) await wait(delay, signal);
      throwIfAborted(signal);
      bucket.lastStartedAt = now();
    });
    bucket.startTail = start.then(() => undefined, () => undefined);
    return start;
  };

  const request = (input, init = {}) => {
    const url = requestUrl(input, baseUrl);
    const bucketKey = requestBucketKey(input, init, baseUrl);
    const bucket = getBucket(bucketKey);
    const coalescible = isCoalescibleRead(input, init);
    const identity = coalescible ? readIdentity(input, init, baseUrl) : '';
    if (coalescible) {
      const existing = inFlightReads.get(identity);
      if (existing) return existing.then(response => response.clone());
    }

    const execute = () => {
      if (UNTHROTTLED_PATHS.has(url.pathname)) {
        throwIfAborted(init.signal);
        return fetchImpl(input, init);
      }
      return scheduleStart(bucket, init.signal).then(() => fetchImpl(input, init));
    };
    const serializedMutation = isSerializedMutation(input, init, baseUrl);
    const transport = serializedMutation
      ? bucket.mutationTail.catch(() => undefined).then(execute)
      : execute();
    if (serializedMutation) {
      bucket.mutationTail = transport.then(() => undefined, () => undefined);
    }
    if (!coalescible) return transport;

    inFlightReads.set(identity, transport);
    void transport.finally(() => {
      if (inFlightReads.get(identity) === transport) inFlightReads.delete(identity);
    }).catch(() => {});
    return transport.then(response => response.clone());
  };

  return { request };
}

const nativeFetch = globalThis.fetch.bind(globalThis);
const requestCoordinator = createRequestCoordinator({ fetchImpl: nativeFetch });
let applicationApiRequests = 0;
let operationsBootstrapTimer = null;
let operationsBootstrapStarted = false;

function emitApiLog(detail) {
  window.dispatchEvent(new CustomEvent('basketra:api-log', { detail }));
}

function requestPath(path) {
  try {
    return new URL(path, location.origin).pathname;
  } catch {
    return '/';
  }
}

function isSameOriginRequest(path) {
  try {
    const baseUrl = globalThis.location?.origin || 'http://localhost';
    const url = new URL(path instanceof Request ? path.url : String(path), baseUrl);
    return url.origin === baseUrl;
  } catch {
    return false;
  }
}

export function coordinatedFetch(path, options = {}) {
  return isSameOriginRequest(path)
    ? requestCoordinator.request(path, options)
    : nativeFetch(path, options);
}

function scheduleOperationsBootstrap() {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  if (operationsBootstrapStarted || operationsBootstrapTimer !== null) return;
  operationsBootstrapTimer = setTimeout(() => {
    operationsBootstrapTimer = null;
    if (applicationApiRequests > 0) return;
    operationsBootstrapStarted = true;
    void import('./operations.js').catch(() => {});
  }, 0);
}

function receiptLineRoot(element) {
  return element.closest('.receipt-item, [data-receipt-line-editor]');
}

function receiptLineField(root, field) {
  return root?.querySelector(`[data-field="${field}"]`);
}

function receiptCalculationStatus(root, message) {
  const status = root?.querySelector('.receipt-line-derived-state');
  if (!status) return;
  status.textContent = message;
  status.hidden = !message;
}

function receiptCalculationStateFor(root) {
  let state = receiptCalculationState.get(root);
  if (state) return state;
  state = {
    controller: null,
    timer: null,
    version: 0,
    pending: false,
    error: null,
    waiters: new Set(),
  };
  receiptCalculationState.set(root, state);
  return state;
}

function settleReceiptCalculation(state) {
  state.pending = false;
  for (const resolve of state.waiters) resolve();
  state.waiters.clear();
}

function waitForReceiptCalculation(root) {
  const state = receiptCalculationState.get(root);
  if (!state?.pending) return Promise.resolve();
  return new Promise(resolve => state.waiters.add(resolve));
}

function markDerivedReceiptTotal(root) {
  const total = receiptLineField(root, 'lineTotalEuro');
  if (total instanceof HTMLInputElement) {
    total.readOnly = true;
    total.setAttribute('aria-readonly', 'true');
  } else if (!(total instanceof HTMLOutputElement)) {
    return undefined;
  }
  total.dataset.derivedTotal = 'true';
  return total;
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

async function readReceiptCalculationInput(root) {
  const quantityInput = receiptLineField(root, 'quantity');
  const unitPriceInput = receiptLineField(root, 'unitPriceEuro');
  const discountTypeInput = receiptLineField(root, 'discountType');
  const discountValueInput = receiptLineField(root, 'discountValue');
  if (!(quantityInput instanceof HTMLInputElement) || !(unitPriceInput instanceof HTMLInputElement)) return undefined;
  const quantity = Number(quantityInput.value);
  if (!Number.isSafeInteger(quantity) || quantity < 0) return undefined;
  try {
    const { euroInputToMinor } = await import('./ui.js');
    const input = {
      quantity,
      unitPriceMinor: euroInputToMinor(unitPriceInput.value),
    };
    if (!(discountTypeInput instanceof HTMLSelectElement) || discountTypeInput.value === 'none') return input;
    if (!(discountValueInput instanceof HTMLInputElement) || !discountValueInput.value.trim()) return undefined;
    if (discountTypeInput.value === 'amount') {
      return { ...input, discount: { type: 'amount', amountMinor: euroInputToMinor(discountValueInput.value) } };
    }
    if (discountTypeInput.value === 'percentage') {
      return { ...input, discount: { type: 'percentage', basisPoints: percentageInputToBasisPoints(discountValueInput.value) } };
    }
    return undefined;
  } catch {
    return undefined;
  }
}

function receiptActionRoots(button) {
  if (button.id === 'save-receipt-line-editor') {
    const root = button.closest('#receipt-line-dialog')?.querySelector('.receipt-item, [data-receipt-line-editor]');
    return root ? [root] : [];
  }
  if (button.matches('[data-receipt-action="validate"]')) {
    const root = button.closest('.receipt-item, [data-receipt-line-editor]');
    return root ? [root] : [];
  }
  return [...document.querySelectorAll('.receipt-item, [data-receipt-line-editor]')];
}

function syncReceiptCalculationActions() {
  document.querySelectorAll(RECEIPT_CALCULATION_ACTION_SELECTOR).forEach(button => {
    if (!(button instanceof HTMLButtonElement)) return;
    const blocked = receiptActionRoots(button).some(root => receiptCalculationState.get(root)?.error);
    if (blocked) {
      if (!button.disabled) {
        button.disabled = true;
        button.dataset.receiptCalculationDisabled = 'true';
      }
      return;
    }
    if (button.dataset.receiptCalculationDisabled === 'true') {
      button.disabled = false;
      delete button.dataset.receiptCalculationDisabled;
    }
  });
}

async function calculateReceiptLine(root, version) {
  const total = markDerivedReceiptTotal(root);
  if (!total) return;
  const state = receiptCalculationStateFor(root);
  if (version !== state.version) return;
  state.controller?.abort();
  const controller = new AbortController();
  state.controller = controller;
  total.setAttribute('aria-busy', 'true');
  receiptCalculationStatus(root, 'Calculando total…');
  try {
    const input = await readReceiptCalculationInput(root);
    if (version !== state.version) return;
    if (!input) {
      state.error = new Error('Completa cantidad, precio y descuento para calcular el total.');
      receiptCalculationStatus(root, state.error.message);
      syncReceiptCalculationActions();
      return;
    }
    const result = await api(RECEIPT_CALCULATION_PATH, {
      method: 'POST',
      signal: controller.signal,
      body: JSON.stringify(input),
    });
    if (version !== state.version || !root.isConnected) return;
    const { minorToEuroInput } = await import('./ui.js');
    if (version !== state.version || !root.isConnected) return;
    total.value = minorToEuroInput(result.lineTotalMinor);
    total.dispatchEvent(new Event('input', { bubbles: true }));
    state.error = null;
    receiptCalculationStatus(root, 'Total actualizado.');
    syncReceiptCalculationActions();
  } catch (error) {
    if (error?.name === 'AbortError' || version !== state.version) return;
    state.error = error instanceof Error ? error : new Error(String(error));
    receiptCalculationStatus(root, `No se pudo calcular el total: ${state.error.message}`);
    syncReceiptCalculationActions();
  } finally {
    if (version === state.version) {
      total.setAttribute('aria-busy', 'false');
      state.controller = null;
      settleReceiptCalculation(state);
    }
  }
}

function scheduleReceiptLineCalculation(root, immediate = false) {
  if (!root) return;
  const total = markDerivedReceiptTotal(root);
  if (!total) return;
  const state = receiptCalculationStateFor(root);
  const version = ++state.version;
  state.pending = true;
  state.error = null;
  syncReceiptCalculationActions();
  clearTimeout(state.timer);
  state.controller?.abort();
  state.timer = setTimeout(() => void calculateReceiptLine(root, version), immediate ? 0 : RECEIPT_CALCULATION_DELAY_MS);
}

function receiptActionNeedsCalculation(roots) {
  return roots.some(root => {
    const state = receiptCalculationState.get(root);
    return state?.pending || state?.error;
  });
}

async function resumeReceiptAction(button, roots) {
  setBusy(button, true);
  await Promise.all(roots.map(waitForReceiptCalculation));
  const blocked = roots.some(root => receiptCalculationState.get(root)?.error);
  setBusy(button, false);
  if (blocked || !button.isConnected) return;
  button.click();
}

function deferReceiptActionUntilCalculated(event) {
  const button = event.target.closest?.(RECEIPT_CALCULATION_ACTION_SELECTOR);
  if (!(button instanceof HTMLButtonElement)) return;
  const roots = receiptActionRoots(button);
  if (roots.length === 0 || !receiptActionNeedsCalculation(roots)) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  void resumeReceiptAction(button, roots);
}

function enhanceReceiptLine(root) {
  const total = markDerivedReceiptTotal(root);
  if (!total || root.querySelector('.receipt-line-derived-state')) return;
  const resultContainer = total.closest('.receipt-line-result, label');
  if (!resultContainer) return;
  const status = document.createElement('small');
  status.className = 'receipt-line-derived-state field-help';
  status.setAttribute('aria-live', 'polite');
  status.hidden = true;
  const layoutContainer = resultContainer.closest('.quantity-row');
  if (layoutContainer) {
    status.style.gridColumn = '1 / -1';
    status.style.minWidth = '0';
    layoutContainer.append(status);
  } else {
    resultContainer.append(status);
  }
}

function enhanceExistingReceiptLines(root) {
  root.querySelectorAll?.('.receipt-item, [data-receipt-line-editor]').forEach(enhanceReceiptLine);
}

function resetDiscountValueAfterTypeChange(target) {
  if (target?.dataset?.field !== 'discountType') return;
  const root = receiptLineRoot(target);
  const value = receiptLineField(root, 'discountValue');
  if (value instanceof HTMLInputElement) value.value = target.value === 'none' ? '' : '0';
}

function restoredEditorRootFromClick(event) {
  const button = event.target.closest?.('#cancel-receipt-line-editor, #close-receipt-line-editor');
  return button?.closest('#receipt-line-dialog')?.querySelector('.receipt-item, [data-receipt-line-editor]');
}

function restoredEditorRootFromCancel(event) {
  const dialog = event.target;
  if (!(dialog instanceof HTMLDialogElement) || dialog.id !== 'receipt-line-dialog') return undefined;
  return dialog.querySelector('.receipt-item, [data-receipt-line-editor]');
}

function scheduleRestoredReceiptCalculation(root) {
  if (!root) return;
  queueMicrotask(() => scheduleReceiptLineCalculation(root, true));
}

function initializeReceiptDerivedTotals() {
  if (receiptDerivedTotalsInitialized) return;
  receiptDerivedTotalsInitialized = true;
  enhanceExistingReceiptLines(document);

  const observer = new MutationObserver(records => {
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (!(node instanceof Element)) continue;
        if (node.matches('.receipt-item, [data-receipt-line-editor]')) enhanceReceiptLine(node);
        enhanceExistingReceiptLines(node);
      }
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });

  document.addEventListener('input', event => {
    if (!RECEIPT_CALCULATION_DRIVER_FIELDS.has(event.target?.dataset?.field)) return;
    scheduleReceiptLineCalculation(receiptLineRoot(event.target));
  }, true);
  document.addEventListener('change', event => {
    if (!RECEIPT_CALCULATION_DRIVER_FIELDS.has(event.target?.dataset?.field)) return;
    resetDiscountValueAfterTypeChange(event.target);
    scheduleReceiptLineCalculation(receiptLineRoot(event.target), true);
  }, true);
  document.addEventListener('click', event => scheduleRestoredReceiptCalculation(restoredEditorRootFromClick(event)), true);
  document.addEventListener('cancel', event => scheduleRestoredReceiptCalculation(restoredEditorRootFromCancel(event)), true);
  document.addEventListener('click', deferReceiptActionUntilCalculated, true);
}

export async function api(path, options = {}) {
  applicationApiRequests += 1;
  try {
    const method = options.method || 'GET';
    const started = performance.now();
    let response;
    try {
      response = await coordinatedFetch(path, {
        ...options,
        headers: {
          ...(options.body ? { 'content-type': 'application/json' } : {}),
          ...(options.headers || {}),
        },
      });
    } catch (error) {
      if (error?.name !== 'AbortError') {
        emitApiLog({
          event: 'client.network_error',
          level: 'error',
          method,
          path: requestPath(path),
          durationMs: Math.round(performance.now() - started),
          code: 'NETWORK_ERROR',
        });
      }
      throw error;
    }

    if (response.status === 204) return undefined;
    const contentType = response.headers.get('content-type') || '';
    const body = contentType.includes('application/json')
      ? await response.json().catch(() => ({}))
      : await response.text();

    if (!response.ok) {
      const message = typeof body === 'object' && body !== null && body.error?.message
        ? body.error.message
        : `HTTP ${response.status}`;
      const error = new Error(message);
      if (typeof body === 'object' && body !== null) {
        error.code = body.error?.code;
        error.details = body.error?.details;
      }
      error.status = response.status;
      const requestId = response.headers.get('x-request-id') || (typeof body === 'object' && body !== null ? body.error?.requestId : undefined);
      if (requestId) error.requestId = requestId;
      emitApiLog({
        event: 'client.api_error',
        level: response.status >= 500 ? 'error' : 'warn',
        method,
        path: requestPath(path),
        status: response.status,
        durationMs: Math.round(performance.now() - started),
        ...(error.code ? { code: error.code } : {}),
        ...(requestId ? { requestId } : {}),
      });
      throw error;
    }

    return body;
  } finally {
    applicationApiRequests -= 1;
    scheduleOperationsBootstrap();
  }
}

export function realtimeEndpoint() {
  return '/api/v1/realtime';
}

export function setBusy(element, busy) {
  element.disabled = busy;
  element.setAttribute('aria-busy', String(busy));
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  // Keep api.js as the browser HTTP SSOT even when a feature accidentally calls fetch directly.
  // EventSource and service-worker traffic run in different transport paths and are not wrapped here.
  globalThis.fetch = coordinatedFetch;
  initializeReceiptDerivedTotals();
  const activateCatalog = globalThis.location?.hash === '#catalog';
  void import('./catalog.js')
    .then(module => module.initializeCatalogFeature({ activate: activateCatalog }))
    .catch(() => {});
  scheduleOperationsBootstrap();
}
