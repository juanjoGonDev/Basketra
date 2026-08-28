export const DEFAULT_REQUEST_THROTTLE_MS = 1000;

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
  ].join(' ');
}

function isCoalescibleRead(input, init) {
  const method = requestMethod(input, init);
  return (method === 'GET' || method === 'HEAD')
    && init.body === undefined
    && init.signal === undefined;
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

  const enqueue = (bucketKey, signal, execute) => {
    let bucket = buckets.get(bucketKey);
    if (!bucket) {
      bucket = {
        lastStartedAt: Number.NEGATIVE_INFINITY,
        tail: Promise.resolve(),
      };
      buckets.set(bucketKey, bucket);
    }

    const previous = bucket.tail.catch(() => undefined);
    const task = previous.then(async () => {
      throwIfAborted(signal);
      const elapsed = now() - bucket.lastStartedAt;
      const delay = Number.isFinite(bucket.lastStartedAt)
        ? Math.max(0, throttleMs - elapsed)
        : 0;
      if (delay > 0) await wait(delay, signal);
      throwIfAborted(signal);
      bucket.lastStartedAt = now();
      return execute();
    });
    bucket.tail = task.then(() => undefined, () => undefined);
    return task;
  };

  const request = (input, init = {}) => {
    const bucketKey = requestBucketKey(input, init, baseUrl);
    const coalescible = isCoalescibleRead(input, init);
    const identity = coalescible ? readIdentity(input, init, baseUrl) : '';
    if (coalescible) {
      const existing = inFlightReads.get(identity);
      if (existing) return existing.then(response => response.clone());
    }

    const transport = enqueue(bucketKey, init.signal, () => fetchImpl(input, init));
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

export async function api(path, options = {}) {
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
}

export function realtimeEndpoint() {
  return '/api/v1/realtime';
}

export function setBusy(element, busy) {
  element.disabled = busy;
  element.setAttribute('aria-busy', String(busy));
}

function formatProviderHealth(lastCheck) {
  if (!lastCheck || typeof lastCheck !== 'object') {
    return {
      state: 'neutral',
      title: 'Todavía sin comprobación persistida',
      detail: 'Basketra ejecuta una comprobación automática al arrancar y guarda el resultado en la base de datos.',
    };
  }
  const checkedAt = Number.isNaN(Date.parse(lastCheck.checkedAt))
    ? 'fecha desconocida'
    : new Date(lastCheck.checkedAt).toLocaleString('es-ES');
  const trigger = lastCheck.trigger === 'startup' ? 'inicio automático' : 'comprobación manual';
  if (lastCheck.status === 'success') {
    const model = lastCheck.connection?.model ? ` · ${lastCheck.connection.model}` : '';
    return {
      state: 'ok',
      title: 'Proveedor IA operativo',
      detail: `${checkedAt} · ${trigger}${model} · capacidad de imagen y salida estructurada verificadas · ${Math.max(0, Number(lastCheck.durationMs) || 0)} ms`,
    };
  }
  return {
    state: 'error',
    title: 'Proveedor IA no operativo',
    detail: `${checkedAt} · ${trigger} · ${lastCheck.errorCode || 'AI_PROVIDER_FAILED'} · ${Math.max(0, Number(lastCheck.durationMs) || 0)} ms`,
  };
}

function ensureProviderHealthRegion() {
  const status = document.querySelector('#ai-configuration-status');
  const card = status?.closest('.operations-card, .surface');
  const reference = document.querySelector('#ai-provider-network-note');
  if (!(card instanceof HTMLElement) || !(reference instanceof HTMLElement)) return null;
  let region = document.querySelector('#ai-provider-health');
  if (region instanceof HTMLElement) return region;
  region = document.createElement('div');
  region.id = 'ai-provider-health';
  region.className = 'provider-check provider-health';
  region.setAttribute('aria-live', 'polite');
  const title = document.createElement('strong');
  title.dataset.providerHealthTitle = '';
  const detail = document.createElement('span');
  detail.dataset.providerHealthDetail = '';
  region.append(title, detail);
  reference.before(region);
  const explanation = [...card.querySelectorAll('p')]
    .find(element => element.textContent?.includes('Sólo se ejecuta al pulsar el botón.'));
  if (explanation) {
    explanation.textContent = 'La comprobación real envía una imagen sintética sin datos personales y exige una respuesta JSON conforme a un esquema estricto. Basketra la ejecuta automáticamente al arrancar y puedes repetirla manualmente después de actualizar webApi.';
  }
  return region;
}

function renderProviderHealth(lastCheck) {
  const region = ensureProviderHealthRegion();
  if (!region) return;
  const formatted = formatProviderHealth(lastCheck);
  region.dataset.state = formatted.state;
  const title = region.querySelector('[data-provider-health-title]');
  const detail = region.querySelector('[data-provider-health-detail]');
  if (title) title.textContent = formatted.title;
  if (detail) detail.textContent = formatted.detail;
}

let providerHealthRefreshGeneration = 0;
async function refreshProviderHealth() {
  const generation = ++providerHealthRefreshGeneration;
  try {
    const settings = await api('/api/v1/settings/ai-provider', { cache: 'no-store' });
    if (generation !== providerHealthRefreshGeneration) return;
    renderProviderHealth(settings.lastCheck);
  } catch {
    // Existing Settings connectivity state is the canonical transport error UI.
  }
}

function enhanceProviderHealth() {
  const button = document.querySelector('#test-ai-provider');
  if (!(button instanceof HTMLButtonElement)) return;
  ensureProviderHealthRegion();
  if (button.dataset.healthObserver !== 'true') {
    button.dataset.healthObserver = 'true';
    const observer = new MutationObserver(() => {
      if (!button.disabled) void refreshProviderHealth();
    });
    observer.observe(button, { attributes: true, attributeFilter: ['disabled'] });
  }
  void refreshProviderHealth();
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  // Keep api.js as the browser HTTP SSOT even when a feature accidentally calls fetch directly.
  // EventSource and service-worker traffic run in different transport paths and are not wrapped here.
  globalThis.fetch = coordinatedFetch;
  const providerHealthObserver = new MutationObserver(() => enhanceProviderHealth());
  providerHealthObserver.observe(document.documentElement, { childList: true, subtree: true });
  document.addEventListener('DOMContentLoaded', enhanceProviderHealth, { once: true });
  enhanceProviderHealth();
  void import('./operations.js').catch(() => {});
}
