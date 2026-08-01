const LOG_COPY_LIMIT = 500;

const state = {
  count: 0,
  payload: '',
  loading: null,
};

function serializeEvents(events) {
  return events.length > 0
    ? `${events.map(event => JSON.stringify(event)).join('\n')}\n`
    : '';
}

async function loadCopyPayload(button, status) {
  if (state.loading) return state.loading;
  button.disabled = true;
  status.textContent = 'Preparando logs completos…';
  state.loading = (async () => {
    const response = await fetch(`/api/v1/logs?limit=${LOG_COPY_LIMIT}`, { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const body = await response.json();
    const events = Array.isArray(body.events)
      ? body.events.filter(event => typeof event === 'object' && event !== null)
      : [];
    state.count = events.length;
    state.payload = serializeEvents(events);
    status.textContent = events.length > 0
      ? `${events.length} eventos completos preparados.`
      : 'Todavía no hay logs para copiar.';
    return state.payload;
  })();
  try {
    return await state.loading;
  } finally {
    state.loading = null;
    button.disabled = state.payload.length === 0;
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
    if (!state.payload) await loadCopyPayload(button, status);
    if (!state.payload) return;
    await writeClipboard(state.payload);
    status.textContent = `${state.count} eventos copiados como JSON, una línea por evento.`;
  } catch {
    status.textContent = 'No se pudo acceder al portapapeles. Revisa el permiso del navegador y vuelve a intentarlo.';
  } finally {
    button.removeAttribute('aria-busy');
    button.disabled = state.payload.length === 0;
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
  refreshButton.addEventListener('click', () => void loadCopyPayload(copyButton, status));
  window.addEventListener('basketra:connection-restored', () => void loadCopyPayload(copyButton, status));
  void loadCopyPayload(copyButton, status);
}

installLogCopy();
