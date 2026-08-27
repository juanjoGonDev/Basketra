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

export async function api(path, options = {}) {
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
    const response = await fetch('/api/v1/settings/ai-provider', { cache: 'no-store' });
    if (!response.ok) return;
    const settings = await response.json();
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

const providerHealthObserver = new MutationObserver(() => enhanceProviderHealth());
providerHealthObserver.observe(document.documentElement, { childList: true, subtree: true });
document.addEventListener('DOMContentLoaded', enhanceProviderHealth, { once: true });
enhanceProviderHealth();

void import('./operations.js').catch(() => {});
