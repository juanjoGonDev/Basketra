const LOG_COPY_LIMIT = 500;

const logCopyState = {
  count: 0,
  payload: '',
  loading: null,
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
    if (typeof body === 'object' && body !== null) error.code = body.error?.code;
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

export function setBusy(element, busy) {
  element.disabled = busy;
  element.setAttribute('aria-busy', String(busy));
}

function serializeLogEvents(events) {
  return events.length > 0
    ? `${events.map(event => JSON.stringify(event)).join('\n')}\n`
    : '';
}

async function loadLogCopyPayload(button, status) {
  if (logCopyState.loading) return logCopyState.loading;
  button.disabled = true;
  status.textContent = 'Preparando logs completos…';
  logCopyState.loading = (async () => {
    const response = await fetch(`/api/v1/logs?limit=${LOG_COPY_LIMIT}`, { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const body = await response.json();
    const events = Array.isArray(body.events)
      ? body.events.filter(event => typeof event === 'object' && event !== null)
      : [];
    logCopyState.count = events.length;
    logCopyState.payload = serializeLogEvents(events);
    status.textContent = events.length > 0
      ? `${events.length} eventos completos preparados.`
      : 'Todavía no hay logs para copiar.';
    return logCopyState.payload;
  })();
  try {
    return await logCopyState.loading;
  } finally {
    logCopyState.loading = null;
    button.disabled = logCopyState.payload.length === 0;
  }
}

function copyWithSelection(text) {
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.readOnly = true;
  textarea.setAttribute('aria-hidden', 'true');
  textarea.style.position = 'fixed';
  textarea.style.inset = '0';
  textarea.style.opacity = '0';
  textarea.style.pointerEvents = 'none';
  document.body.append(textarea);
  textarea.focus({ preventScroll: true });
  textarea.select();
  textarea.setSelectionRange(0, text.length);
  const copied = document.execCommand('copy');
  textarea.remove();
  if (!copied) throw new Error('CLIPBOARD_UNAVAILABLE');
}

async function writeClipboard(text) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // Private HTTP deployments may not expose the asynchronous Clipboard API.
    }
  }
  copyWithSelection(text);
}

async function copyLogs(button, status) {
  button.disabled = true;
  button.setAttribute('aria-busy', 'true');
  status.textContent = 'Copiando logs…';
  try {
    if (!logCopyState.payload) await loadLogCopyPayload(button, status);
    if (!logCopyState.payload) return;
    await writeClipboard(logCopyState.payload);
    status.textContent = `${logCopyState.count} eventos copiados como JSON, una línea por evento.`;
  } catch {
    status.textContent = 'No se pudo acceder al portapapeles. Revisa el permiso del navegador y vuelve a intentarlo.';
  } finally {
    button.removeAttribute('aria-busy');
    button.disabled = logCopyState.payload.length === 0;
  }
}

function installLogCopy() {
  const refreshButton = document.querySelector('#refresh-logs');
  const logContainer = document.querySelector('#application-logs');
  if (!refreshButton || !logContainer || document.querySelector('#copy-logs')) return;

  const actions = document.createElement('div');
  actions.className = 'inline-actions';
  refreshButton.before(actions);
  actions.append(refreshButton);

  const copyButton = document.createElement('button');
  copyButton.id = 'copy-logs';
  copyButton.className = 'button secondary';
  copyButton.type = 'button';
  copyButton.textContent = 'Copiar logs';
  copyButton.disabled = true;
  actions.append(copyButton);

  const hint = document.createElement('small');
  hint.textContent = `La copia incluye hasta ${LOG_COPY_LIMIT} eventos censurados completos en JSON por línea, sin omitir campos del evento.`;
  actions.after(hint);

  const status = document.createElement('p');
  status.id = 'copy-logs-state';
  status.className = 'inline-status';
  status.setAttribute('role', 'status');
  hint.after(status);

  copyButton.addEventListener('click', () => void copyLogs(copyButton, status));
  refreshButton.addEventListener('click', () => void loadLogCopyPayload(copyButton, status));
  window.addEventListener('basketra:connection-restored', () => void loadLogCopyPayload(copyButton, status));
  void loadLogCopyPayload(copyButton, status);
}

void import('./operations.js')
  .then(() => installLogCopy())
  .catch(() => {});
