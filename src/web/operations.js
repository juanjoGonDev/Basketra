const MAX_BACKUP_IMPORT_BYTES = 512 * 1024 * 1024;
const LOG_COPY_LIMIT = 500;
const LOG_RENDER_LIMIT = 120;

const state = {
  heartbeatTimer: null,
  heartbeatController: null,
  heartbeatGeneration: 0,
  connected: null,
  startedAt: null,
  uptimeTimer: null,
  clientLogs: [],
  clientFlushTimer: null,
  importedBackups: [],
  logCopyCount: 0,
  logCopyPayload: '',
  aiSettings: null,
};

const $ = selector => document.querySelector(selector);

function emitClientLog(event) {
  if (!event || typeof event !== 'object' || state.clientLogs.length >= 40) return;
  state.clientLogs.push(event);
  if (state.clientFlushTimer) return;
  state.clientFlushTimer = setTimeout(() => void flushClientLogs(), 1500);
}

async function flushClientLogs() {
  clearTimeout(state.clientFlushTimer);
  state.clientFlushTimer = null;
  if (state.clientLogs.length === 0 || state.connected === false) return;
  const events = state.clientLogs.splice(0, 20);
  try {
    await fetch('/api/v1/logs/client', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ events }),
      keepalive: true,
    });
  } catch {
    state.clientLogs.unshift(...events.slice(-20));
  }
  if (state.clientLogs.length > 0) state.clientFlushTimer = setTimeout(() => void flushClientLogs(), 2000);
}

function setConnection(connected) {
  const previous = state.connected;
  state.connected = connected;
  const element = $('#connection-state');
  if (element) {
    element.dataset.ok = connected ? 'true' : 'false';
    element.innerHTML = connected
      ? '<span data-icon="wifi"></span>Conectado'
      : '<span data-icon="wifi-off"></span>Desconectado';
  }
  if (connected && previous === false) {
    window.dispatchEvent(new CustomEvent('basketra:connection-restored'));
    emitClientLog({ event: 'client.connection_restored', level: 'info' });
    void refreshOperationalState();
  }
  if (!connected && previous !== false) emitClientLog({ event: 'client.connection_lost', level: 'warn' });
}

function scheduleHeartbeat(delay) {
  clearTimeout(state.heartbeatTimer);
  if (document.hidden) return;
  state.heartbeatTimer = setTimeout(() => void heartbeat(), delay);
}

async function heartbeat() {
  const generation = ++state.heartbeatGeneration;
  state.heartbeatController?.abort();
  const controller = new AbortController();
  state.heartbeatController = controller;
  const timeout = setTimeout(() => controller.abort(), 4000);
  try {
    const response = await fetch(`/health?heartbeat=${Date.now()}`, {
      cache: 'no-store',
      signal: controller.signal,
    });
    if (generation !== state.heartbeatGeneration) return;
    setConnection(response.ok);
  } catch {
    if (generation !== state.heartbeatGeneration) return;
    setConnection(false);
  } finally {
    clearTimeout(timeout);
    if (generation === state.heartbeatGeneration) scheduleHeartbeat(state.connected ? 15000 : 2000);
  }
}

function formatDuration(milliseconds) {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return [
    days > 0 ? `${days} d` : '',
    `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`,
  ].filter(Boolean).join(' ');
}

function updateUptime() {
  const element = $('#server-uptime');
  if (!element || !state.startedAt) return;
  element.textContent = formatDuration(Date.now() - new Date(state.startedAt).getTime());
}

async function requestJson(path, options = {}) {
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
    emitClientLog({
      event: 'client.network_error',
      level: 'error',
      method: options.method || 'GET',
      path: new URL(path, location.origin).pathname,
      durationMs: Math.round(performance.now() - started),
      code: 'NETWORK_ERROR',
    });
    throw error;
  }
  const contentType = response.headers.get('content-type') || '';
  const body = contentType.includes('application/json') ? await response.json().catch(() => ({})) : await response.text();
  if (!response.ok) {
    const code = body && typeof body === 'object' ? body.error?.code || body.connection?.code : undefined;
    const message = body && typeof body === 'object'
      ? body.error?.message || body.connection?.message
      : undefined;
    const error = new Error(message || `HTTP ${response.status}`);
    error.code = code;
    error.status = response.status;
    emitClientLog({
      event: 'client.api_error',
      level: response.status >= 500 ? 'error' : 'warn',
      method: options.method || 'GET',
      path: new URL(path, location.origin).pathname,
      status: response.status,
      durationMs: Math.round(performance.now() - started),
      ...(code ? { code } : {}),
      ...(response.headers.get('x-request-id') ? { requestId: response.headers.get('x-request-id') } : {}),
    });
    throw error;
  }
  return body;
}

function renderRuntime(diagnostics) {
  const runtime = diagnostics.runtime || {};
  state.startedAt = runtime.startedAt || diagnostics.startedAt || null;
  $('#runtime-version').textContent = runtime.version || 'desconocida';
  $('#runtime-revision').textContent = runtime.revision ? runtime.revision.slice(0, 12) : 'sin revisión';
  $('#server-started-at').textContent = state.startedAt ? new Date(state.startedAt).toLocaleString('es-ES') : 'desconocido';
  $('#runtime-memory').textContent = diagnostics.memory?.rss
    ? `${Math.round(diagnostics.memory.rss / 1024 / 1024)} MB RSS`
    : 'sin datos';
  updateUptime();
}

function providerProbeUrl(settings) {
  if (!settings?.baseUrl) return '';
  try {
    const baseUrl = new URL(settings.baseUrl);
    if (!baseUrl.pathname.endsWith('/')) baseUrl.pathname += '/';
    return new URL('chat/completions', baseUrl).href;
  } catch {
    return `${settings.baseUrl.replace(/\/?$/, '/')}chat/completions`;
  }
}

function providerHost(settings) {
  try {
    return new URL(settings?.baseUrl || '').hostname.toLowerCase();
  } catch {
    return '';
  }
}

function providerNetworkGuidance(settings) {
  const host = providerHost(settings);
  if (host === 'host.docker.internal') {
    return 'host.docker.internal apunta al host Docker de Basketra, es decir, a la Raspberry. Si webApi se ejecuta en otro equipo, usa la IP privada de ese equipo en BASKETRA_AI_BASE_URL y configura webApi con HOST=0.0.0.0, restringiendo el puerto a tu LAN o VPN.';
  }
  if (host === '127.0.0.1' || host === 'localhost' || host === '::1' || host === '[::1]') {
    return 'Una dirección loopback apunta al propio contenedor Basketra. Usa host.docker.internal sólo si webApi está en la Raspberry; si está en otro equipo, usa su IP privada.';
  }
  return 'La prueba sale desde el contenedor Basketra. El equipo que ejecuta webApi debe escuchar en esa dirección y puerto; para clientes remotos webApi necesita HOST=0.0.0.0 y el puerto debe quedar limitado a la LAN o VPN.';
}

function renderAiSettings(settings) {
  state.aiSettings = settings;
  const status = $('#ai-configuration-status');
  const detail = $('#ai-configuration-detail');
  const testButton = $('#test-ai-provider');
  const request = $('#ai-provider-request');
  const authorization = $('#ai-provider-authorization');
  const note = $('#ai-provider-network-note');
  request.textContent = settings.configured ? `POST ${providerProbeUrl(settings)}` : 'Pendiente de configuración';
  authorization.textContent = settings.apiKeyMask ? 'Bearer con token gestionado' : 'Sin cabecera Authorization';
  note.textContent = settings.configured ? providerNetworkGuidance(settings) : '';
  if (!settings.configured) {
    status.textContent = 'Configuración no cargada';
    status.dataset.state = 'error';
    detail.textContent = `Faltan: ${(settings.missing || []).join(', ')}. Guarda cada variable en una línea y recrea el contenedor.`;
    testButton.disabled = true;
    return;
  }
  testButton.disabled = false;
  if (settings.loopbackWarning) {
    status.textContent = 'Configurado con dirección incorrecta para Docker';
    status.dataset.state = 'warning';
    detail.textContent = `${settings.model} · ${settings.baseUrl}${settings.apiKeyMask ? ` · token ${settings.apiKeyMask}` : ''}`;
    return;
  }
  status.textContent = 'Configuración cargada';
  status.dataset.state = 'ok';
  detail.textContent = `${settings.model} · ${settings.baseUrl}${settings.apiKeyMask ? ` · token ${settings.apiKeyMask}` : ''}`;
}

async function loadRuntime() {
  try {
    renderRuntime(await requestJson('/api/v1/diagnostics'));
  } catch (error) {
    $('#runtime-state').textContent = error.message;
  }
}

async function loadAiSettings() {
  try {
    renderAiSettings(await requestJson('/api/v1/settings/ai-provider'));
  } catch (error) {
    $('#ai-configuration-status').textContent = error.message;
  }
}

function renderLogs(events) {
  const container = $('#application-logs');
  container.replaceChildren();
  if (!events.length) {
    container.textContent = 'Todavía no hay eventos.';
    return;
  }
  for (const event of events) {
    const row = document.createElement('li');
    row.className = `operations-log operations-log--${event.level}`;
    const heading = document.createElement('strong');
    heading.textContent = `${new Date(event.timestamp).toLocaleTimeString('es-ES')} · ${event.source} · ${event.event}`;
    const detail = document.createElement('small');
    detail.textContent = [event.method, event.path, event.status, event.code, event.requestId].filter(value => value !== undefined).join(' · ');
    row.append(heading, detail);
    container.append(row);
  }
}

function serializeLogEvents(events) {
  return events.length > 0
    ? `${events.map(event => JSON.stringify(event)).join('\n')}\n`
    : '';
}

function prepareLogCopy(events) {
  state.logCopyCount = events.length;
  state.logCopyPayload = serializeLogEvents(events);
  const button = $('#copy-logs');
  const status = $('#copy-logs-state');
  button.disabled = state.logCopyPayload.length === 0;
  status.textContent = events.length > 0
    ? `${events.length} eventos completos preparados para copiar.`
    : 'Todavía no hay logs para copiar.';
}

async function loadLogs() {
  const button = $('#refresh-logs');
  const copyButton = $('#copy-logs');
  button.disabled = true;
  copyButton.disabled = true;
  try {
    const result = await requestJson(`/api/v1/logs?limit=${LOG_COPY_LIMIT}`);
    const events = Array.isArray(result.events) ? result.events : [];
    renderLogs(events.slice(-LOG_RENDER_LIMIT));
    prepareLogCopy(events);
  } catch (error) {
    $('#application-logs').textContent = error.message;
    $('#copy-logs-state').textContent = state.logCopyPayload
      ? 'No se pudieron actualizar los logs. La última copia preparada sigue disponible.'
      : 'No se pudieron preparar los logs para copiar.';
    copyButton.disabled = state.logCopyPayload.length === 0;
  } finally {
    button.disabled = false;
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

async function copyLogs() {
  const button = $('#copy-logs');
  const status = $('#copy-logs-state');
  button.disabled = true;
  button.setAttribute('aria-busy', 'true');
  status.textContent = 'Copiando logs…';
  try {
    if (!state.logCopyPayload) await loadLogs();
    if (!state.logCopyPayload) return;
    await writeClipboard(state.logCopyPayload);
    status.textContent = `${state.logCopyCount} eventos copiados como JSON, una línea por evento.`;
  } catch {
    status.textContent = 'No se pudo acceder al portapapeles. Revisa el permiso del navegador y vuelve a intentarlo.';
  } finally {
    button.removeAttribute('aria-busy');
    button.disabled = state.logCopyPayload.length === 0;
  }
}

function renderImportedBackups(backups) {
  state.importedBackups = backups;
  const select = $('#restore-backup-select');
  select.replaceChildren();
  if (!backups.length) {
    const option = document.createElement('option');
    option.value = '';
    option.textContent = 'No hay copias importadas';
    select.append(option);
    select.disabled = true;
    $('#stage-restore').disabled = true;
    return;
  }
  select.disabled = false;
  for (const backup of backups) {
    const option = document.createElement('option');
    option.value = backup.name;
    option.textContent = `${backup.name} · ${Math.ceil(backup.bytes / 1024)} KB · esquema ${backup.schemaVersion}`;
    select.append(option);
  }
  $('#stage-restore').disabled = false;
}

async function loadImportedBackups() {
  try {
    const result = await requestJson('/api/v1/restore/imports');
    renderImportedBackups(result.backups || []);
  } catch (error) {
    $('#restore-state').textContent = error.message;
  }
}

async function createBackup() {
  const button = $('#create-operational-backup');
  button.disabled = true;
  $('#backup-state').textContent = 'Creando copia portable…';
  try {
    const name = `basketra-${new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-')}.db`;
    const result = await requestJson('/api/v1/backup', {
      method: 'POST',
      body: JSON.stringify({ name }),
    });
    const link = $('#backup-download-link');
    link.href = `/api/v1/backups/${encodeURIComponent(result.backup.name)}`;
    link.download = result.backup.name;
    link.hidden = false;
    link.textContent = `Descargar ${result.backup.name}`;
    $('#backup-state').textContent = `Copia creada (${Math.ceil(result.backup.bytes / 1024)} KB). Decide si quieres descargarla.`;
    await loadLogs();
  } catch (error) {
    $('#backup-state').textContent = error.message;
  } finally {
    button.disabled = false;
  }
}

async function importBackupFile() {
  const input = $('#backup-import-file');
  const file = input.files?.[0];
  if (!file) {
    $('#restore-state').textContent = 'Selecciona una copia .db.';
    return;
  }
  if (!file.name.toLowerCase().endsWith('.db') || file.size === 0 || file.size > MAX_BACKUP_IMPORT_BYTES) {
    $('#restore-state').textContent = 'La copia debe ser un archivo .db no vacío de hasta 512 MiB.';
    return;
  }
  const button = $('#import-backup');
  button.disabled = true;
  $('#restore-state').textContent = 'Subiendo por streaming y validando integridad…';
  try {
    const result = await requestJson(`/api/v1/restore/import?name=${encodeURIComponent(file.name)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/vnd.sqlite3' },
      body: file,
    });
    $('#restore-state').textContent = `Copia validada: esquema ${result.backup.schemaVersion}, ${Math.ceil(result.backup.bytes / 1024)} KB.`;
    input.value = '';
    await loadImportedBackups();
    await loadLogs();
  } catch (error) {
    $('#restore-state').textContent = error.message;
  } finally {
    button.disabled = false;
  }
}

async function stageRestore() {
  const name = $('#restore-backup-select').value;
  const confirmation = $('#restore-confirmation').value.trim();
  if (!name || confirmation !== 'RESTAURAR') {
    $('#restore-state').textContent = 'Selecciona una copia y escribe RESTAURAR exactamente.';
    return;
  }
  const button = $('#stage-restore');
  button.disabled = true;
  $('#restore-state').textContent = 'Creando copia previa y preparando reinicio…';
  try {
    await requestJson('/api/v1/restore/stage', {
      method: 'POST',
      body: JSON.stringify({ name, confirmation }),
    });
    $('#restore-state').textContent = 'Restauración preparada. Basketra se reiniciará y volverá a conectarse automáticamente.';
  } catch (error) {
    $('#restore-state').textContent = error.message;
    button.disabled = false;
  }
}

async function testAiProvider() {
  const button = $('#test-ai-provider');
  const stateElement = $('#ai-test-state');
  const probe = providerProbeUrl(state.aiSettings);
  button.disabled = true;
  stateElement.textContent = `Enviando una imagen sintética a POST ${probe} y validando el esquema estricto…`;
  try {
    const result = await requestJson('/api/v1/settings/ai-provider/test', { method: 'POST' });
    stateElement.textContent = result.connection.ok && result.connection.imageStructuredOutput
      ? `Capacidad verificada: autenticación, modelo, adjunto de imagen y salida estructurada estricta funcionan en ${probe}.`
      : 'El proveedor respondió sin confirmar la capacidad multimodal estructurada.';
  } catch (error) {
    const messages = {
      AI_LOOPBACK_CONTAINER: providerNetworkGuidance(state.aiSettings),
      AI_UNREACHABLE: `No se pudo abrir una conexión con ${probe}. ${providerNetworkGuidance(state.aiSettings)}`,
      AI_AUTHENTICATION_FAILED: 'webApi respondió, pero rechazó el token. Crea un token gestionado en /admin y copia su valor completo en BASKETRA_AI_API_KEY.',
      AI_TIMEOUT: `La prueba multimodal no terminó dentro del tiempo configurado al solicitar ${probe}.`,
      AI_ATTACHMENT_TOO_LARGE: 'El proveedor rechazó incluso la imagen sintética mínima por tamaño. Revisa los límites del proveedor.',
      AI_ATTACHMENT_UPLOAD_FAILED: 'El proveedor no pudo preparar la imagen sintética en el compositor. Revisa el estado del navegador de webApi.',
      AI_REQUEST_REJECTED: 'El proveedor rechazó la imagen o el esquema estricto. Revisa el modelo configurado y el contrato OpenAI-compatible.',
      AI_RATE_LIMITED: 'El proveedor está limitando solicitudes. Espera y vuelve a ejecutar la prueba manualmente.',
      AI_INVALID_RESPONSE: 'El proveedor respondió, pero no respetó el esquema estricto de la prueba.',
      AI_EMPTY_RESPONSE: 'El proveedor completó la petición sin devolver contenido estructurado.',
      AI_RESPONSE_TOO_LARGE: 'La respuesta de la prueba superó el límite configurado.',
      AI_PROVIDER_FAILED: 'El proveedor falló al procesar la imagen sintética.',
    };
    stateElement.textContent = messages[error.code] || `${error.message}. Solicitud probada: POST ${probe}.`;
  } finally {
    button.disabled = false;
    await loadLogs();
  }
}

function installOperationsUi() {
  const settings = $('.view[data-view="settings"]');
  if (!settings || $('#runtime-operations')) return;
  const legacyBackup = $('#download-backup');
  if (legacyBackup) legacyBackup.hidden = true;
  const section = document.createElement('section');
  section.id = 'runtime-operations';
  section.className = 'operations-stack';
  section.innerHTML = `
    <section class="surface operations-card" aria-labelledby="runtime-title">
      <div class="panel-heading"><div><p class="eyebrow">Ejecución</p><h2 id="runtime-title">Servidor y versión</h2></div></div>
      <div class="operations-metrics">
        <div><small>Versión</small><strong id="runtime-version">Cargando…</strong></div>
        <div><small>Activo</small><strong id="server-uptime">00:00:00</strong></div>
        <div><small>Inicio</small><strong id="server-started-at">Cargando…</strong></div>
        <div><small>Memoria</small><strong id="runtime-memory">Cargando…</strong></div>
      </div>
      <p class="operations-secondary">Revisión: <span id="runtime-revision">Cargando…</span></p>
      <p id="runtime-state" class="inline-status" role="status"></p>
    </section>
    <section class="surface operations-card" aria-labelledby="ai-config-title">
      <div class="panel-heading"><div><p class="eyebrow">Proveedor opcional</p><h2 id="ai-config-title">Diagnóstico de IA</h2></div></div>
      <strong id="ai-configuration-status">Cargando…</strong>
      <p id="ai-configuration-detail"></p>
      <dl class="provider-check">
        <div><dt>Comprobación real</dt><dd id="ai-provider-request">Cargando…</dd></div>
        <div><dt>Autorización</dt><dd id="ai-provider-authorization">Cargando…</dd></div>
      </dl>
      <p>La prueba envía una imagen sintética sin datos personales y exige una respuesta JSON conforme a un esquema estricto. Sólo se ejecuta al pulsar el botón.</p>
      <p id="ai-provider-network-note" class="operations-help"></p>
      <button id="test-ai-provider" class="button secondary full" type="button">Verificar imagen y JSON estricto</button>
      <p id="ai-test-state" class="inline-status" role="status"></p>
    </section>
    <section class="surface operations-card" aria-labelledby="logs-title">
      <div class="panel-heading"><div><p class="eyebrow">Observabilidad</p><h2 id="logs-title">Logs de aplicación</h2></div></div>
      <p>Sólo se muestran eventos estructurados y censurados; nunca contenido de tickets, claves o cuerpos de petición.</p>
      <div class="inline-actions operations-log-actions">
        <button id="refresh-logs" class="button secondary" type="button">Actualizar logs</button>
        <button id="copy-logs" class="button secondary" type="button" disabled>Copiar logs</button>
      </div>
      <small>La copia incluye hasta ${LOG_COPY_LIMIT} eventos completos en JSON por línea, con los mismos campos censurados del backend.</small>
      <p id="copy-logs-state" class="inline-status" role="status">Preparando logs…</p>
      <ul id="application-logs" class="operations-logs" aria-live="polite"></ul>
    </section>
    <section class="surface operations-card" aria-labelledby="backup-title">
      <div class="panel-heading"><div><p class="eyebrow">Recuperación</p><h2 id="backup-title">Copias de seguridad</h2></div></div>
      <button id="create-operational-backup" class="button secondary full" type="button">Crear copia</button>
      <a id="backup-download-link" class="button primary full" hidden>Descargar copia</a>
      <p id="backup-state" class="inline-status" role="status"></p>
      <hr>
      <label class="field"><span>Importar copia SQLite (.db)</span><input id="backup-import-file" type="file" accept=".db,application/vnd.sqlite3,application/octet-stream"></label>
      <button id="import-backup" class="button secondary full" type="button">Importar y validar</button>
      <label class="field"><span>Copia validada</span><select id="restore-backup-select"><option value="">Cargando…</option></select></label>
      <label class="field"><span>Confirmación</span><input id="restore-confirmation" autocomplete="off" placeholder="Escribe RESTAURAR"></label>
      <button id="stage-restore" class="button danger full" type="button" disabled>Restaurar tras reinicio</button>
      <p id="restore-state" class="inline-status" role="status"></p>
    </section>`;
  settings.append(section);
  $('#test-ai-provider').addEventListener('click', () => void testAiProvider());
  $('#refresh-logs').addEventListener('click', () => void loadLogs());
  $('#copy-logs').addEventListener('click', () => void copyLogs());
  $('#create-operational-backup').addEventListener('click', () => void createBackup());
  $('#import-backup').addEventListener('click', () => void importBackupFile());
  $('#stage-restore').addEventListener('click', () => void stageRestore());
}

async function refreshOperationalState() {
  await Promise.allSettled([loadRuntime(), loadAiSettings(), loadLogs(), loadImportedBackups()]);
}

function installClientLogging() {
  window.addEventListener('basketra:api-log', event => emitClientLog(event.detail));
  window.addEventListener('error', event => emitClientLog({
    event: 'client.javascript_error',
    level: 'error',
    code: event.error?.name === 'TypeError' ? 'TYPE_ERROR' : 'SCRIPT_ERROR',
  }));
  window.addEventListener('unhandledrejection', event => emitClientLog({
    event: 'client.unhandled_rejection',
    level: 'error',
    code: event.reason?.name === 'AbortError' ? 'ABORT_ERROR' : 'UNHANDLED_REJECTION',
  }));
}

function installHeartbeat() {
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      clearTimeout(state.heartbeatTimer);
      state.heartbeatController?.abort();
      return;
    }
    scheduleHeartbeat(0);
  });
  window.addEventListener('online', () => scheduleHeartbeat(0));
  window.addEventListener('offline', () => {
    setConnection(false);
    scheduleHeartbeat(2000);
  });
  window.addEventListener('basketra:connection-restored', () => void flushClientLogs());
  scheduleHeartbeat(0);
}

function init() {
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = '/operations.css';
  document.head.append(link);
  installOperationsUi();
  installClientLogging();
  installHeartbeat();
  clearInterval(state.uptimeTimer);
  state.uptimeTimer = setInterval(updateUptime, 1000);
  void refreshOperationalState();
}

init();