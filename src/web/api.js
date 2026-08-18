const AI_PROVIDER_SETTINGS_PATH = '/api/v1/settings/ai-provider';
const AI_PROVIDER_SETTINGS_FRESH_MS = 10_000;

const aiProviderSettingsCache = {
  value: null,
  expiresAt: 0,
  promise: null,
};

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

async function performApiRequest(path, options = {}) {
  const method = options.method || 'GET';
  const started = performance.now();
  let response;
  try {
    response = await fetch(path, {
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

function canShareAiProviderSettings(path, options) {
  const method = options.method || 'GET';
  return method === 'GET'
    && requestPath(path) === AI_PROVIDER_SETTINGS_PATH
    && !options.signal;
}

function invalidateAiProviderSettings() {
  aiProviderSettingsCache.value = null;
  aiProviderSettingsCache.expiresAt = 0;
}

async function readAiProviderSettings(path, options) {
  const now = Date.now();
  if (aiProviderSettingsCache.value !== null && aiProviderSettingsCache.expiresAt > now) {
    return aiProviderSettingsCache.value;
  }
  if (aiProviderSettingsCache.promise) return aiProviderSettingsCache.promise;

  aiProviderSettingsCache.promise = performApiRequest(path, options)
    .then(value => {
      aiProviderSettingsCache.value = value;
      aiProviderSettingsCache.expiresAt = Date.now() + AI_PROVIDER_SETTINGS_FRESH_MS;
      return value;
    });
  try {
    return await aiProviderSettingsCache.promise;
  } finally {
    aiProviderSettingsCache.promise = null;
  }
}

export async function api(path, options = {}) {
  if (canShareAiProviderSettings(path, options)) {
    return readAiProviderSettings(path, options);
  }
  return performApiRequest(path, options);
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
      title: 'Última comprobación correcta',
      detail: `${checkedAt} · ${trigger}${model} · ${Math.max(0, Number(lastCheck.durationMs) || 0)} ms`,
    };
  }
  return {
    state: 'error',
    title: 'Última comprobación con error',
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
  region.className = 'provider-health';
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

let providerHealthRefreshPromise = null;
async function refreshProviderHealth() {
  if (providerHealthRefreshPromise) return providerHealthRefreshPromise;
  providerHealthRefreshPromise = (async () => {
    try {
      const settings = await api(AI_PROVIDER_SETTINGS_PATH, { cache: 'no-store' });
      renderProviderHealth(settings.lastCheck);
    } catch {
      // Existing Settings connectivity state is the canonical transport error UI.
    }
  })();
  try {
    await providerHealthRefreshPromise;
  } finally {
    providerHealthRefreshPromise = null;
  }
}

function enhanceProviderHealth() {
  const button = document.querySelector('#test-ai-provider');
  if (!(button instanceof HTMLButtonElement)) return;
  ensureProviderHealthRegion();
  if (button.dataset.healthObserver === 'true') return;

  button.dataset.healthObserver = 'true';
  const observer = new MutationObserver(records => {
    const busyChanged = records.some(record => record.attributeName === 'aria-busy');
    if (busyChanged && !button.hasAttribute('aria-busy') && !button.disabled) {
      invalidateAiProviderSettings();
      void refreshProviderHealth();
    }
  });
  observer.observe(button, { attributes: true, attributeFilter: ['aria-busy'] });
  void refreshProviderHealth();
}

document.addEventListener('DOMContentLoaded', enhanceProviderHealth, { once: true });

void import('./operations.js')
  .then(() => enhanceProviderHealth())
  .catch(() => {});
