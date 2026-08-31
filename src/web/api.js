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
const RECEIPT_CALCULATION_DRIVER_FIELDS = new Set(['quantity', 'unitPriceEuro', 'discountEuro']);
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
  if (status) status.textContent = message;
}

function receiptCalculationStateFor(root) {
  let state = receiptCalculationState.get(root);
  if (state) return state;
  state = { controller: null, timer: null, version: 0 };
  receiptCalculationState.set(root, state);
  return state;
}

function markDerivedReceiptTotal(root) {
  const total = receiptLineField(root, 'lineTotalEuro');
  if (!(total instanceof HTMLInputElement)) return undefined;
  total.readOnly = true;
  total.setAttribute('aria-readonly', 'true');
  total.dataset.derivedTotal = 'true';
  return total;
}

async function readReceiptCalculationInput(root) {
  const quantityInput = receiptLineField(root, 'quantity');
  const unitPriceInput = receiptLineField(root, 'unitPriceEuro');
  const discountInput = receiptLineField(root, 'discountEuro');
  if (!(quantityInput instanceof HTMLInputElement) || !(unitPriceInput instanceof HTMLInputElement)) return undefined;
  const quantity = Number(quantityInput.value);
  if (!Number.isSafeInteger(quantity) || quantity < 0) return undefined;
  try {
    const { euroInputToMinor } = await import('./ui.js');
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
      receiptCalculationStatus(root, 'Completa cantidad, precio y descuento para calcular el total.');
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
    receiptCalculationStatus(root, 'Total actualizado.');
  } catch (error) {
    if (error?.name === 'AbortError' || version !== state.version) return;
    receiptCalculationStatus(root, `No se pudo calcular el total: ${error.message}`);
  } finally {
    if (version === state.version) {
      total.setAttribute('aria-busy', 'false');
      state.controller = null;
    }
  }
}

function scheduleReceiptLineCalculation(root, immediate = false) {
  if (!root) return;
  const total = markDerivedReceiptTotal(root);
  if (!total) return;
  const state = receiptCalculationStateFor(root);
  const version = ++state.version;
  clearTimeout(state.timer);
  state.controller?.abort();
  state.timer = setTimeout(() => void calculateReceiptLine(root, version), immediate ? 0 : RECEIPT_CALCULATION_DELAY_MS);
}

function enhanceReceiptLine(root) {
  const total = markDerivedReceiptTotal(root);
  if (!total || root.querySelector('.receipt-line-derived-state')) return;
  const label = total.closest('label');
  if (!label) return;
  const status = document.createElement('small');
  status.className = 'receipt-line-derived-state field-help';
  status.setAttribute('aria-live', 'polite');
  status.textContent = 'Se actualiza al cambiar cantidad, precio o descuento.';
  label.append(status);
}

function enhanceExistingReceiptLines(root) {
  root.querySelectorAll?.('.receipt-item, [data-receipt-line-editor]').forEach(enhanceReceiptLine);
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
    scheduleReceiptLineCalculation(receiptLineRoot(event.target), true);
  }, true);
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
