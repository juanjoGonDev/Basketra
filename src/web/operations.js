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
    const error = new Error(body && typeof body === 'object' && body.error?.message ? body.error.message : `HTTP ${response.status}`);
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

function renderAiSettings(settings) {
  const status = $('#ai-configuration-status');
  const detail = $('#ai-configuration-detail');
  const testButton = $('#test-ai-provider');
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
    detail.textContent = `El contenedor no puede usar ${settings.baseUrl}. Usa ${settings.recommendedHostUrl} y fuerza la recreación.`;
    return;
  }
  status.textContent = 'Configuración cargada';
  status.dataset.state = 'ok';
  detail.textContent = `${settings.model} · ${settings.baseUrl}${settings.apiKeyMask ? ` · clave ${settings.apiKeyMask}` : ''}`;
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

async function loadLogs() {
  const button = $('#refresh-logs');
  button.disabled = true;
  try {
    const result = await requestJson('/api/v1/logs?limit=120');
    renderLogs(result.events || []);
  } catch (error) {
    $('#application-logs').textContent = error.message;
  } finally {
    button.disabled = false;
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

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error || new Error('No se pudo leer la copia'));
    reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
    reader.readAsDataURL(file);
  });
}

async function importBackupFile() {
  const input = $('#backup-import-file');
  const file = input.files?.[0];
  if (!file) {
    $('#restore-state').textContent = 'Selecciona una copia .db.';
    return;
  }
  const button = $('#import-backup');
  button.disabled = true;
  $('#restore-state').textContent = 'Subiendo y validando integridad…';
  try {
    const result = await requestJson('/api/v1/restore/import', {
      method: 'POST',
      body: JSON.stringify({ name: file.name, base64: await fileToBase64(file) }),
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
  button.disabled = true;
  $('#ai-test-state').textContent = 'Comprobando desde el contenedor…';
  try {
    const result = await requestJson('/api/v1/settings/ai-provider/test', { method: 'POST' });
    $('#ai-test-state').textContent = result.connection.ok ? 'Conexión correcta.' : result.connection.code;
  } catch (error) {
    const messages = {
      AI_LOOPBACK_CONTAINER: '127.0.0.1 apunta al contenedor. Usa host.docker.internal y recréalo.',
      AI_UNREACHABLE: 'La configuración está cargada, pero el proveedor no es alcanzable.',
      AI_AUTHENTICATION_FAILED: 'El proveedor rechazó la clave configurada.',
      AI_TIMEOUT: 'El proveedor no respondió dentro del tiempo configurado.',
    };
    $('#ai-test-state').textContent = messages[error.code] || error.message;
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
      <button id="test-ai-provider" class="button secondary full" type="button">Probar desde Basketra</button>
      <p id="ai-test-state" class="inline-status" role="status"></p>
    </section>
    <section class="surface operations-card" aria-labelledby="logs-title">
      <div class="panel-heading"><div><p class="eyebrow">Observabilidad</p><h2 id="logs-title">Logs de aplicación</h2></div></div>
      <p>Sólo se muestran eventos estructurados y redacted; nunca contenido de tickets, claves o cuerpos de petición.</p>
      <button id="refresh-logs" class="button secondary full" type="button">Actualizar logs</button>
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
