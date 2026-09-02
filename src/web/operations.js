import { icon } from './ui.js';

const MAX_BACKUP_IMPORT_BYTES = 512 * 1024 * 1024;
const LOG_COPY_LIMIT = 500;
const LOG_RENDER_LIMIT = 120;
const MEBIBYTE = 1024 * 1024;
const MINUTE_MS = 60 * 1000;

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
  aiTestGeneration: 0,
  aiTestController: null,
  runtimeSettings: null,
  runtimeSettingsDirty: false,
  runtimeSettingsSaving: false,
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
      ? `${icon('wifi')}<span>Conectado</span>`
      : `${icon('wifiOff')}<span>Desconectado</span>`;
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
  const { onRequestStarted, method = 'GET', ...fetchOptions } = options;
  const started = performance.now();
  let response;
  try {
    const request = fetch(path, {
      ...fetchOptions,
      method,
      headers: {
        ...(fetchOptions.body ? { 'content-type': 'application/json' } : {}),
        ...(fetchOptions.headers || {}),
      },
    });
    onRequestStarted?.();
    response = await request;
  } catch (error) {
    if (error.name === 'AbortError') throw error;
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
      method,
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
    return 'host.docker.internal apunta al host Docker de Basketra, es decir, a la Raspberry. Si webApi se ejecuta en otro equipo, guarda aquí la URL con la IP privada de ese equipo y asegúrate de que webApi escucha en esa interfaz, limitada a tu LAN o VPN.';
  }
  if (host === '127.0.0.1' || host === 'localhost' || host === '::1' || host === '[::1]') {
    return 'Una dirección loopback apunta al propio contenedor Basketra. Usa host.docker.internal si webApi está en la Raspberry; si está en otro equipo, guarda aquí su IP privada.';
  }
  return 'La prueba sale desde el contenedor Basketra. El equipo que ejecuta webApi debe escuchar en la dirección y puerto guardados, restringidos a tu LAN o VPN.';
}

function aiTestIsRunning() {
  return state.aiTestController !== null;
}

function renderAiTestStatus(lifecycle, message) {
  const status = $('#ai-test-state');
  const button = $('#test-ai-provider');
  if (!status || !button) return;
  status.dataset.state = lifecycle;
  status.textContent = message;
  const running = aiTestIsRunning();
  button.disabled = running || !state.aiSettings?.configured || state.runtimeSettingsSaving;
  button.toggleAttribute('aria-busy', running);
}

function renderAiSettings(settings) {
  state.aiSettings = settings;
  const status = $('#ai-configuration-status');
  const detail = $('#ai-configuration-detail');
  const testButton = $('#test-ai-provider');
  const request = $('#ai-provider-request');
  const authorization = $('#ai-provider-authorization');
  const note = $('#ai-provider-network-note');
  if (!status || !detail || !testButton || !request || !authorization || !note) return;
  request.textContent = settings.configured ? `POST ${providerProbeUrl(settings)}` : 'Pendiente de configuración';
  authorization.textContent = settings.apiKeyMask ? `Token guardado ${settings.apiKeyMask}` : 'Sin cabecera Authorization';
  note.textContent = settings.configured ? providerNetworkGuidance(settings) : 'Configura WebAPI en este formulario. Los cambios se guardan en Basketra y se aplican sin recrear el contenedor.';
  if (!settings.configured) {
    status.textContent = 'Falta configuración';
    status.dataset.state = 'error';
    detail.textContent = `Completa ${(settings.missing || []).join(' y ')} y pulsa Guardar cambios. No hace falta reiniciar Basketra.`;
    testButton.disabled = true;
    return;
  }
  testButton.disabled = aiTestIsRunning() || state.runtimeSettingsSaving;
  if (settings.loopbackWarning) {
    status.textContent = 'Dirección incorrecta para Docker';
    status.dataset.state = 'warning';
    detail.textContent = `${settings.model} · ${settings.baseUrl}${settings.apiKeyMask ? ` · token ${settings.apiKeyMask}` : ''}`;
    return;
  }
  status.textContent = 'Configuración activa';
  status.dataset.state = 'ok';
  detail.textContent = `${settings.model} · ${settings.baseUrl}${settings.apiKeyMask ? ` · token ${settings.apiKeyMask}` : ''} · ${settings.maxRetries ?? 1} reintentos máx.`;
}

function renderRuntimeSettings(settings, force = false) {
  state.runtimeSettings = settings;
  if (state.runtimeSettingsDirty && !force) return;
  const ai = settings.ai || {};
  $('#runtime-ai-base-url').value = ai.baseUrl || '';
  $('#runtime-ai-model').value = ai.model || '';
  $('#runtime-ai-max-retries').value = String(ai.maxRetries ?? 1);
  $('#runtime-ai-api-key').value = '';
  $('#runtime-ai-clear-token').checked = false;
  $('#runtime-ai-clear-token').disabled = !ai.apiKeyConfigured;
  $('#runtime-ai-api-key').disabled = false;
  $('#runtime-ai-token-help').textContent = ai.apiKeyConfigured
    ? `Token guardado ${ai.apiKeyMask || ''}. Deja el campo vacío para conservarlo o marca “Eliminar token guardado”.`
    : 'No hay token guardado. Déjalo vacío si tu WebAPI no requiere Authorization.';
  $('#runtime-overpass-base-url').value = settings.overpassBaseUrl || '';
  $('#runtime-max-body-mib').value = String(settings.maxBodyBytes / MEBIBYTE);
  $('#runtime-idle-minutes').value = String(settings.idleHibernateAfterMs / MINUTE_MS);
  state.runtimeSettingsDirty = false;
}

function runtimeSettingsPayload() {
  const apiKey = $('#runtime-ai-api-key').value.trim();
  const clearApiKey = $('#runtime-ai-clear-token').checked;
  return {
    aiBaseUrl: $('#runtime-ai-base-url').value.trim() || null,
    aiModel: $('#runtime-ai-model').value.trim() || null,
    aiMaxRetries: Number($('#runtime-ai-max-retries').value),
    ...(clearApiKey ? { aiApiKey: null } : apiKey ? { aiApiKey: apiKey } : {}),
    overpassBaseUrl: $('#runtime-overpass-base-url').value.trim(),
    maxBodyBytes: Math.round(Number($('#runtime-max-body-mib').value) * MEBIBYTE),
    idleHibernateAfterMs: Math.round(Number($('#runtime-idle-minutes').value) * MINUTE_MS),
  };
}

function setRuntimeSettingsSaving(saving) {
  state.runtimeSettingsSaving = saving;
  const button = $('#save-runtime-settings');
  const form = $('#runtime-settings-form');
  button.disabled = saving;
  button.toggleAttribute('aria-busy', saving);
  for (const control of form.elements) {
    if (control.id === 'runtime-ai-clear-token' && !state.runtimeSettings?.ai?.apiKeyConfigured) continue;
    control.disabled = saving;
  }
  if (!saving) {
    $('#runtime-ai-clear-token').disabled = !state.runtimeSettings?.ai?.apiKeyConfigured;
    $('#runtime-ai-api-key').disabled = $('#runtime-ai-clear-token').checked;
  }
  renderAiTestStatus($('#ai-test-state').dataset.state || 'idle', $('#ai-test-state').textContent || '');
}

async function saveRuntimeSettings(event) {
  event.preventDefault();
  const form = $('#runtime-settings-form');
  const status = $('#runtime-settings-save-state');
  if (!form.reportValidity() || state.runtimeSettingsSaving) return;
  setRuntimeSettingsSaving(true);
  status.dataset.state = 'saving';
  status.textContent = 'Guardando y aplicando la configuración…';
  try {
    const result = await requestJson('/api/v1/settings/runtime', {
      method: 'PUT',
      body: JSON.stringify(runtimeSettingsPayload()),
    });
    state.runtimeSettingsDirty = false;
    renderRuntimeSettings(result.settings, true);
    await Promise.all([loadAiSettings(), loadRuntime()]);
    status.dataset.state = 'success';
    status.textContent = 'Configuración guardada en SQLite. La siguiente operación usa estos valores; no hace falta reiniciar ni recrear el contenedor.';
  } catch (error) {
    status.dataset.state = 'error';
    status.textContent = error.message;
  } finally {
    setRuntimeSettingsSaving(false);
  }
}

async function loadRuntime() {
  try {
    renderRuntime(await requestJson('/api/v1/diagnostics'));
  } catch (error) {
    $('#runtime-state').textContent = error.message;
  }
}

async function loadRuntimeSettings(force = false) {
  try {
    const result = await requestJson('/api/v1/settings/runtime');
    renderRuntimeSettings(result.settings, force);
  } catch (error) {
    $('#runtime-settings-save-state').dataset.state = 'error';
    $('#runtime-settings-save-state').textContent = error.message;
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
    $('#backup-download-label').textContent = `Descargar ${result.backup.name}`;
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
  const generation = ++state.aiTestGeneration;
  state.aiTestController?.abort();
  const controller = new AbortController();
  state.aiTestController = controller;
  const settings = state.aiSettings;
  const probe = providerProbeUrl(settings);
  renderAiTestStatus('preparing', 'Preparando la imagen sintética y la prueba de esquema estricto…');
  try {
    await Promise.resolve();
    renderAiTestStatus('uploading', `Enviando una imagen sintética a POST ${probe} y validando el esquema estricto…`);
    await Promise.resolve();
    const result = await requestJson('/api/v1/settings/ai-provider/test', {
      method: 'POST',
      signal: controller.signal,
      onRequestStarted: () => {
        if (generation === state.aiTestGeneration) {
          renderAiTestStatus('waiting', 'La imagen se está comprobando; esperando la validación del proveedor…');
        }
      },
    });
    if (result?.connection?.ok === true && result.connection.imageStructuredOutput === true) {
      renderAiTestStatus('success', `Capacidad verificada: autenticación, modelo, adjunto de imagen y salida estructurada estricta funcionan en ${probe}.`);
      return;
    }
    renderAiTestStatus('recoverable-error', 'El proveedor respondió sin confirmar la capacidad multimodal estructurada. Puedes revisar la configuración y volver a intentarlo.');
  } catch (error) {
    if (generation !== state.aiTestGeneration || error.name === 'AbortError') return;
    const messages = {
      AI_LOOPBACK_CONTAINER: providerNetworkGuidance(settings),
      AI_UNREACHABLE: `No se pudo abrir una conexión con ${probe}. ${providerNetworkGuidance(settings)}`,
      AI_AUTHENTICATION_FAILED: 'webApi respondió, pero rechazó el token. Guarda un token gestionado nuevo en el campo Token de WebAPI y vuelve a probar.',
      AI_TIMEOUT: `webApi o el proveedor agotó su propio tiempo de espera al procesar ${probe}. Basketra no impone un límite de tiempo a esta prueba.`,
      AI_ATTACHMENT_TOO_LARGE: 'El proveedor rechazó incluso la imagen sintética mínima por tamaño. Revisa los límites del proveedor.',
      AI_ATTACHMENT_UPLOAD_FAILED: 'El proveedor no pudo preparar la imagen sintética en el compositor. Revisa el estado del navegador de webApi.',
      AI_REQUEST_REJECTED: 'El proveedor rechazó la imagen o el esquema estricto. Revisa el modelo configurado y el contrato OpenAI-compatible.',
      AI_RATE_LIMITED: 'El proveedor está limitando solicitudes. Espera y vuelve a ejecutar la prueba manualmente.',
      AI_INVALID_RESPONSE: 'El proveedor respondió, pero no respetó el esquema estricto de la prueba.',
      AI_MALFORMED_PROVIDER_RESPONSE: 'El proveedor devolvió una respuesta de transporte no válida.',
      AI_INVALID_STRUCTURED_OUTPUT: 'El proveedor devolvió JSON que no cumple el esquema estricto de la prueba.',
      AI_PROBE_TEXT_MISMATCH: 'El proveedor respondió, pero no pudo leer correctamente la imagen de comprobación.',
      AI_EMPTY_RESPONSE: 'El proveedor completó la petición sin devolver contenido estructurado.',
      AI_RESPONSE_TOO_LARGE: 'La respuesta de la prueba superó el límite configurado.',
      AI_PROVIDER_FAILED: 'El proveedor falló al procesar la imagen sintética.',
    };
    renderAiTestStatus('recoverable-error', `${messages[error.code] || `${error.message}. Solicitud probada: POST ${probe}.`} Puedes volver a intentarlo.`);
  } finally {
    if (generation !== state.aiTestGeneration) return;
    await loadLogs();
    if (generation !== state.aiTestGeneration) return;
    state.aiTestController = null;
    renderAiTestStatus($('#ai-test-state').dataset.state, $('#ai-test-state').textContent);
  }
}

function installGlobalActionIcons() {
  const planButton = $('#run-demo-comparison');
  if (planButton && !planButton.querySelector('.icon')) {
    planButton.insertAdjacentHTML('afterbegin', icon('prices'));
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
        <div class="operations-metric"><span class="operations-metric__icon section-icon">${icon('refresh')}</span><small>Versión</small><strong id="runtime-version">Cargando…</strong></div>
        <div class="operations-metric"><span class="operations-metric__icon section-icon">${icon('checkCircle')}</span><small>Activo</small><strong id="server-uptime">00:00:00</strong></div>
        <div class="operations-metric"><span class="operations-metric__icon section-icon">${icon('clock')}</span><small>Inicio</small><strong id="server-started-at">Cargando…</strong></div>
        <div class="operations-metric"><span class="operations-metric__icon section-icon">${icon('memory')}</span><small>Memoria</small><strong id="runtime-memory">Cargando…</strong></div>
      </div>
      <p class="operations-secondary">Revisión: <span id="runtime-revision">Cargando…</span></p>
      <p id="runtime-state" class="inline-status" role="status"></p>
    </section>
    <section class="surface operations-card" aria-labelledby="runtime-settings-title">
      <div class="panel-heading"><div><p class="eyebrow">Configuración persistente</p><h2 id="runtime-settings-title">Conexiones y límites locales</h2></div></div>
      <p class="operations-help">Estos valores se guardan en SQLite y se aplican a la siguiente operación. No necesitas un archivo <code>.env</code>, reiniciar Basketra ni recrear el contenedor.</p>
      <form id="runtime-settings-form" class="runtime-settings-form">
        <fieldset class="runtime-settings-group">
          <legend>WebAPI</legend>
          <div class="runtime-settings-grid">
            <label class="field runtime-settings-wide"><span>URL de WebAPI</span><input id="runtime-ai-base-url" type="url" maxlength="2048" autocomplete="url" placeholder="http://host.docker.internal:3001/v1/"><small>Déjala vacía para desactivar IA.</small></label>
            <label class="field"><span>Modelo</span><input id="runtime-ai-model" maxlength="240" autocomplete="off" placeholder="default"></label>
            <label class="field"><span>Reintentos máximos</span><input id="runtime-ai-max-retries" type="number" min="0" max="10" step="1" inputmode="numeric" required></label>
            <label class="field runtime-settings-wide"><span>Token de WebAPI</span><input id="runtime-ai-api-key" type="password" maxlength="8192" autocomplete="new-password" placeholder="Vacío = conservar el actual"><small id="runtime-ai-token-help"></small></label>
            <label class="switch-row runtime-settings-wide"><span><strong>Eliminar token guardado</strong><small>Marca esta opción sólo si quieres borrar explícitamente la credencial persistida.</small></span><input id="runtime-ai-clear-token" type="checkbox" aria-label="Eliminar token de WebAPI guardado"><span class="switch"></span></label>
          </div>
        </fieldset>
        <details class="progressive-options runtime-settings-advanced">
          <summary>Red y recursos locales</summary>
          <div class="details-body runtime-settings-grid">
            <label class="field runtime-settings-wide"><span>URL de Overpass</span><input id="runtime-overpass-base-url" type="url" maxlength="2048" autocomplete="url" required></label>
            <label class="field"><span>Límite local por solicitud (MiB)</span><input id="runtime-max-body-mib" type="number" min="0.0009765625" max="512" step="0.25" inputmode="decimal" required><small>No sustituye los límites de adjuntos de WebAPI.</small></label>
            <label class="field"><span>Hibernar tras inactividad (min)</span><input id="runtime-idle-minutes" type="number" min="0" max="1440" step="0.5" inputmode="decimal" required><small>0 desactiva la hibernación interna.</small></label>
          </div>
        </details>
        <button id="save-runtime-settings" class="button primary full" type="submit">${icon('checkCircle')}<span>Guardar cambios</span></button>
        <p id="runtime-settings-save-state" class="inline-status runtime-settings-state" role="status" aria-live="polite"></p>
      </form>
      <div class="runtime-settings-diagnostic" aria-labelledby="ai-config-title">
        <div><p class="eyebrow">Estado WebAPI</p><h3 id="ai-config-title">Diagnóstico de IA</h3></div>
        <strong id="ai-configuration-status">Cargando…</strong>
        <p id="ai-configuration-detail"></p>
        <dl class="provider-check">
          <div><dt>Comprobación real</dt><dd id="ai-provider-request">Cargando…</dd></div>
          <div><dt>Autorización</dt><dd id="ai-provider-authorization">Cargando…</dd></div>
        </dl>
        <p>La prueba envía una imagen sintética sin datos personales y exige una respuesta JSON conforme a un esquema estricto. Sólo se ejecuta al pulsar el botón.</p>
        <p id="ai-provider-network-note" class="operations-help"></p>
        <button id="test-ai-provider" class="button secondary full" type="button">${icon('sparkles')}<span>Verificar imagen y JSON estricto</span></button>
        <p id="ai-test-state" class="inline-status" role="status"></p>
      </div>
    </section>
    <section class="surface operations-card" aria-labelledby="logs-title">
      <div class="panel-heading"><div><p class="eyebrow">Observabilidad</p><h2 id="logs-title">Logs de aplicación</h2></div></div>
      <p>Sólo se muestran eventos estructurados y censurados; nunca contenido de tickets, claves o cuerpos de petición.</p>
      <div class="inline-actions operations-log-actions">
        <button id="refresh-logs" class="button secondary" type="button">${icon('refresh')}<span>Actualizar logs</span></button>
        <button id="copy-logs" class="button secondary" type="button" disabled>${icon('copy')}<span>Copiar logs</span></button>
      </div>
      <small>La copia incluye hasta ${LOG_COPY_LIMIT} eventos completos en JSON por línea, con los mismos campos censurados del backend.</small>
      <p id="copy-logs-state" class="inline-status" role="status">Preparando logs…</p>
      <ul id="application-logs" class="operations-logs" aria-live="polite"></ul>
    </section>
    <section class="surface operations-card" aria-labelledby="backup-title">
      <div class="panel-heading"><div><p class="eyebrow">Recuperación</p><h2 id="backup-title">Copias de seguridad</h2></div></div>
      <button id="create-operational-backup" class="button secondary full" type="button">${icon('backup')}<span>Crear copia</span></button>
      <a id="backup-download-link" class="button primary full" hidden>${icon('download')}<span id="backup-download-label">Descargar copia</span></a>
      <p id="backup-state" class="inline-status" role="status"></p>
      <hr>
      <label class="field"><span>Importar copia SQLite (.db)</span><input id="backup-import-file" type="file" accept=".db,application/vnd.sqlite3,application/octet-stream"></label>
      <button id="import-backup" class="button secondary full" type="button">${icon('upload')}<span>Importar y validar</span></button>
      <label class="field"><span>Copia validada</span><select id="restore-backup-select"><option value="">Cargando…</option></select></label>
      <label class="field"><span>Confirmación</span><input id="restore-confirmation" autocomplete="off" placeholder="Escribe RESTAURAR"></label>
      <button id="stage-restore" class="button danger full" type="button" disabled>${icon('backup')}<span>Restaurar tras reinicio</span></button>
      <p id="restore-state" class="inline-status" role="status"></p>
    </section>`;
  settings.append(section);
  $('#runtime-settings-form').addEventListener('submit', event => void saveRuntimeSettings(event));
  $('#runtime-settings-form').addEventListener('input', event => {
    if (event.target?.id === 'runtime-ai-api-key' && event.target.value) {
      $('#runtime-ai-clear-token').checked = false;
      $('#runtime-ai-api-key').disabled = false;
    }
    state.runtimeSettingsDirty = true;
  });
  $('#runtime-ai-clear-token').addEventListener('change', event => {
    $('#runtime-ai-api-key').disabled = event.target.checked;
    if (event.target.checked) $('#runtime-ai-api-key').value = '';
    state.runtimeSettingsDirty = true;
  });
  $('#test-ai-provider').addEventListener('click', () => void testAiProvider());
  $('#refresh-logs').addEventListener('click', () => void loadLogs());
  $('#copy-logs').addEventListener('click', () => void copyLogs());
  $('#create-operational-backup').addEventListener('click', () => void createBackup());
  $('#import-backup').addEventListener('click', () => void importBackupFile());
  $('#stage-restore').addEventListener('click', () => void stageRestore());
}

async function refreshOperationalState() {
  await Promise.allSettled([loadRuntime(), loadRuntimeSettings(), loadAiSettings(), loadLogs(), loadImportedBackups()]);
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
  installGlobalActionIcons();
  installOperationsUi();
  installClientLogging();
  installHeartbeat();
  clearInterval(state.uptimeTimer);
  state.uptimeTimer = setInterval(updateUptime, 1000);
  void refreshOperationalState();
}

init();
