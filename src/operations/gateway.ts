import { randomUUID } from 'node:crypto';
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { createServer, request as httpRequest, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { OpenAiCompatibleProvider } from '../ai/provider.ts';
import { mapError } from '../api/errors.ts';
import type { AppConfig } from '../infrastructure/config.ts';
import { BasketraServer } from '../api/server.ts';
import { DEFAULT_DATABASE_STORAGE_LIMITS } from '../infrastructure/database.ts';
import { ApplicationLogStore, sanitizeClientLog, type LogSource } from './log-store.ts';
import { importBackupStream, listImportedBackups, RESTORE_CONFIRMATION, stagePendingRestore } from './restore.ts';
import { resolveRuntimeVersion } from './version.ts';

const DIRECT_ASSETS = new Set(['operations.js', 'operations.css', 'receipt-ai-recovery.js']);
const BACKUP_NAME = /^[a-zA-Z0-9._-]+\.db$/;
const BACKUP_CONTENT_TYPES = new Set(['application/vnd.sqlite3', 'application/octet-stream']);
const MAX_CLIENT_LOG_BATCH = 20;
const MAX_CLIENT_LOGS_PER_MINUTE = 120;
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

export type OperationsGatewayOptions = Readonly<{
  requestRestart?: () => void;
  clock?: () => Date;
}>;

function decodePathSegment(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    throw new Error('INVALID_PATH_PARAMETER');
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function readString(record: Record<string, unknown>, key: string, maximum = 240): string {
  const value = record[key];
  if (typeof value !== 'string' || value.length === 0 || value.length > maximum) {
    throw new Error('VALIDATION_ERROR');
  }
  return value;
}

function safeBackupName(value: string): string {
  if (!BACKUP_NAME.test(value) || value.length > 120 || value.includes('..') || value.includes('/') || value.includes('\\')) {
    throw new Error('BACKUP_NAME_INVALID');
  }
  return value;
}

function headerValue(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? '' : value ?? '';
}

function isContainerRuntime(): boolean {
  return process.env['BASKETRA_CONTAINER'] === 'true' || existsSync('/.dockerenv');
}

function safeResponseHeaders(headers: Record<string, string | string[] | undefined>): Record<string, string> {
  const allowed = new Set([
    'cache-control',
    'connection',
    'content-disposition',
    'content-length',
    'content-security-policy',
    'content-type',
    'permissions-policy',
    'referrer-policy',
    'x-accel-buffering',
    'x-content-type-options',
    'x-frame-options',
    'x-request-id',
  ]);
  const result: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    if (!allowed.has(name.toLowerCase()) || value === undefined) continue;
    result[name] = Array.isArray(value) ? value.join(', ') : value;
  }
  return result;
}

export class OperationsGateway {
  readonly config: AppConfig;
  readonly #inner: BasketraServer;
  readonly #server: Server;
  readonly #logStore: ApplicationLogStore;
  readonly #startedAt: string;
  readonly #publicDir: string;
  readonly #requestRestart: (() => void) | undefined;
  readonly #clock: () => Date;
  #innerPort = 0;
  #clientLogWindowStarted = 0;
  #clientLogCount = 0;

  constructor(config: AppConfig, options: OperationsGatewayOptions = {}) {
    this.config = config;
    this.#clock = options.clock ?? (() => new Date());
    this.#startedAt = this.#clock().toISOString();
    this.#requestRestart = options.requestRestart;
    this.#inner = new BasketraServer({ ...config, host: '127.0.0.1', port: 0 });
    this.#logStore = new ApplicationLogStore(config.dataDir, { clock: this.#clock });
    this.#publicDir = resolve(dirname(fileURLToPath(import.meta.url)), '../web');
    this.#server = createServer((request, response) => void this.handle(request, response));
  }

  async listen(): Promise<void> {
    await this.#inner.listen();
    this.#innerPort = this.#inner.address().port;
    await new Promise<void>((resolvePromise, reject) => {
      const onError = (error: Error) => reject(error);
      this.#server.once('error', onError);
      this.#server.listen(this.config.port, this.config.host, () => {
        this.#server.off('error', onError);
        resolvePromise();
      });
    });
    const runtime = resolveRuntimeVersion();
    this.#logStore.append({
      source: 'server',
      level: 'info',
      event: 'server.started',
      code: runtime.version.replaceAll('.', '_').replaceAll('-', '_').toUpperCase(),
    });
  }

  address(): Readonly<{ host: string; port: number }> {
    const address = this.#server.address();
    if (!address || typeof address === 'string') return { host: this.config.host, port: this.config.port };
    return { host: address.address, port: address.port };
  }

  async close(): Promise<void> {
    await new Promise<void>((resolvePromise, reject) => this.#server.close((error) => error ? reject(error) : resolvePromise()));
    await this.#inner.close();
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const requestId = randomUUID();
    const started = Date.now();
    try {
      const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
      if (request.method === 'GET' && DIRECT_ASSETS.has(url.pathname.slice(1))) {
        return this.serveDirectAsset(response, url.pathname.slice(1), requestId);
      }
      if (request.method === 'GET' && url.pathname === '/api/v1/runtime') {
        return this.json(response, 200, this.runtimeMetadata(), requestId);
      }
      if (request.method === 'GET' && url.pathname === '/api/v1/meta') {
        return await this.augmentedMeta(response, requestId);
      }
      if (request.method === 'GET' && url.pathname === '/api/v1/diagnostics') {
        return await this.augmentedDiagnostics(response, requestId);
      }
      if (request.method === 'GET' && url.pathname === '/api/v1/settings/ai-provider') {
        return this.json(response, 200, this.aiSettings(), requestId);
      }
      if (request.method === 'POST' && url.pathname === '/api/v1/settings/ai-provider/test') {
        return await this.testAiProvider(request, response, requestId);
      }
      if (request.method === 'GET' && url.pathname === '/api/v1/logs') {
        return this.readLogs(response, url, requestId);
      }
      if (request.method === 'POST' && url.pathname === '/api/v1/logs/client') {
        return await this.ingestClientLogs(request, response, requestId);
      }
      if (request.method === 'GET' && url.pathname === '/api/v1/restore/imports') {
        return this.json(response, 200, { backups: await listImportedBackups(this.config.dataDir) }, requestId);
      }
      if (request.method === 'POST' && url.pathname === '/api/v1/restore/import') {
        return await this.importBackup(request, response, requestId, url);
      }
      if (request.method === 'POST' && url.pathname === '/api/v1/restore/stage') {
        return await this.stageRestore(request, response, requestId);
      }
      const backupMatch = /^\/api\/v1\/backups\/([^/]+)$/.exec(url.pathname);
      if (request.method === 'GET' && backupMatch?.[1]) {
        return this.downloadBackup(response, decodePathSegment(backupMatch[1]), requestId);
      }
      return this.proxy(request, response, requestId, started);
    } catch (error) {
      const code = error instanceof Error ? error.message : 'OPERATIONS_INTERNAL_ERROR';
      this.#logStore.append({
        source: 'server',
        level: 'error',
        event: 'operations.request_failed',
        requestId,
        method: request.method ?? 'UNKNOWN',
        path: (request.url ?? '/').split('?')[0]?.slice(0, 240) || '/',
        code: /^[A-Z0-9_.-]+$/.test(code) ? code.slice(0, 80) : 'OPERATIONS_INTERNAL_ERROR',
        durationMs: Date.now() - started,
      });
      const status = code.includes('NOT_FOUND') ? 404
        : code.includes('TOO_LARGE') || code.includes('SIZE') ? 413
        : code.includes('CONTENT_TYPE') ? 415
        : code.includes('CONFIRMATION') ? 409
        : code.includes('UNSUPPORTED') ? 422
        : 400;
      this.json(response, status, { error: { code, message: this.errorMessage(code), requestId } }, requestId);
    }
  }

  private runtimeMetadata(): Readonly<Record<string, unknown>> {
    const runtime = resolveRuntimeVersion();
    return {
      name: 'Basketra',
      version: runtime.version,
      ...(runtime.revision ? { revision: runtime.revision } : {}),
      startedAt: this.#startedAt,
      uptimeMs: Math.max(0, this.#clock().getTime() - new Date(this.#startedAt).getTime()),
    };
  }

  private async augmentedMeta(response: ServerResponse, requestId: string): Promise<void> {
    const inner = await this.fetchInner('/api/v1/meta');
    const body = await inner.json() as unknown;
    if (!inner.ok || !isRecord(body)) throw new Error('INNER_META_UNAVAILABLE');
    this.json(response, 200, { ...body, application: this.runtimeMetadata() }, requestId);
  }

  private async augmentedDiagnostics(response: ServerResponse, requestId: string): Promise<void> {
    const inner = await this.fetchInner('/api/v1/diagnostics');
    const body = await inner.json() as unknown;
    if (!inner.ok || !isRecord(body)) throw new Error('INNER_DIAGNOSTICS_UNAVAILABLE');
    this.json(response, 200, { ...body, runtime: this.runtimeMetadata() }, requestId);
  }

  private aiSettings(): Readonly<Record<string, unknown>> {
    const missing: string[] = [];
    if (!this.config.aiBaseUrl) missing.push('BASKETRA_AI_BASE_URL');
    if (!this.config.aiModel) missing.push('BASKETRA_AI_MODEL');
    const configured = missing.length === 0;
    let loopbackWarning = false;
    if (configured && this.config.aiBaseUrl) {
      loopbackWarning = isContainerRuntime() && LOOPBACK_HOSTS.has(new URL(this.config.aiBaseUrl).hostname);
    }
    return {
      configured,
      status: configured ? (loopbackWarning ? 'warning' : 'configured') : 'missing',
      missing,
      ...(this.config.aiBaseUrl ? { baseUrl: this.config.aiBaseUrl } : {}),
      ...(this.config.aiModel ? { model: this.config.aiModel } : {}),
      ...(this.config.aiApiKey ? { apiKeyMask: `***${this.config.aiApiKey.slice(-4)}` } : {}),
      image: this.config.aiImageCapability,
      pdf: this.config.aiPdfCapability,
      loopbackWarning,
      requiresContainerRecreate: true,
      recommendedHostUrl: 'http://host.docker.internal:3001/v1/',
    };
  }

  private async testAiProvider(request: IncomingMessage, response: ServerResponse, requestId: string): Promise<void> {
    const settings = this.aiSettings();
    if (settings['configured'] !== true) {
      this.json(response, 503, {
        connection: { ok: false, code: 'AI_NOT_CONFIGURED', missing: settings['missing'] },
      }, requestId);
      return;
    }
    if (settings['loopbackWarning'] === true) {
      this.#logStore.append({ source: 'server', level: 'warn', event: 'ai.loopback_rejected', requestId, code: 'AI_LOOPBACK_CONTAINER' });
      this.json(response, 502, {
        connection: {
          ok: false,
          code: 'AI_LOOPBACK_CONTAINER',
          message: '127.0.0.1 points to the Basketra container; use host.docker.internal and recreate the container.',
        },
      }, requestId);
      return;
    }

    const provider = new OpenAiCompatibleProvider({
      baseUrl: new URL(this.config.aiBaseUrl!),
      ...(this.config.aiApiKey ? { apiKey: this.config.aiApiKey } : {}),
      model: this.config.aiModel!,
      capabilities: {
        image: this.config.aiImageCapability,
        pdf: this.config.aiPdfCapability,
      },
    });
    const controller = new AbortController();
    const onAborted = () => controller.abort(new Error('REQUEST_ABORTED'));
    request.once('aborted', onAborted);

    try {
      const connection = await provider.testConnection(controller.signal);
      this.#logStore.append({ source: 'server', level: 'info', event: 'ai.capability_probe_ok', requestId });
      this.json(response, 200, { connection }, requestId);
    } catch (error) {
      if (controller.signal.aborted) return;
      const mapped = mapError(error);
      this.#logStore.append({
        source: 'server',
        level: 'warn',
        event: 'ai.capability_probe_failed',
        requestId,
        status: mapped.status,
        code: mapped.code,
      });
      this.json(response, mapped.status, {
        connection: {
          ok: false,
          code: mapped.code,
          status: mapped.status,
          message: mapped.message,
        },
      }, requestId);
    } finally {
      request.off('aborted', onAborted);
      provider.dispose();
    }
  }

  private readLogs(response: ServerResponse, url: URL, requestId: string): void {
    const parsedLimit = Number(url.searchParams.get('limit') ?? 100);
    if (!Number.isSafeInteger(parsedLimit) || parsedLimit < 1 || parsedLimit > 500) throw new Error('LOG_LIMIT_INVALID');
    const sourceValue = url.searchParams.get('source');
    const source: LogSource | undefined = sourceValue === 'server' || sourceValue === 'client' ? sourceValue : undefined;
    this.json(response, 200, { events: this.#logStore.tail(parsedLimit, source) }, requestId);
  }

  private async ingestClientLogs(request: IncomingMessage, response: ServerResponse, requestId: string): Promise<void> {
    const now = this.#clock().getTime();
    if (now - this.#clientLogWindowStarted >= 60_000) {
      this.#clientLogWindowStarted = now;
      this.#clientLogCount = 0;
    }
    const body = await this.readJson(request, 32 * 1024);
    if (!isRecord(body) || !Array.isArray(body['events']) || body['events'].length > MAX_CLIENT_LOG_BATCH) {
      throw new Error('CLIENT_LOG_BATCH_INVALID');
    }
    if (this.#clientLogCount + body['events'].length > MAX_CLIENT_LOGS_PER_MINUTE) {
      this.json(response, 429, { error: { code: 'CLIENT_LOG_RATE_LIMITED', requestId } }, requestId);
      return;
    }
    let accepted = 0;
    for (const value of body['events']) {
      const event = sanitizeClientLog(value, this.#clock().toISOString());
      if (!event) continue;
      this.#logStore.append(event);
      accepted += 1;
    }
    this.#clientLogCount += accepted;
    this.json(response, 202, { accepted }, requestId);
  }

  private async importBackup(request: IncomingMessage, response: ServerResponse, requestId: string, url: URL): Promise<void> {
    const contentType = headerValue(request.headers['content-type']).split(';')[0]?.trim().toLowerCase() ?? '';
    if (!BACKUP_CONTENT_TYPES.has(contentType)) throw new Error('BACKUP_CONTENT_TYPE_INVALID');
    const originalName = safeBackupName(url.searchParams.get('name') ?? '');
    const declaredLength = Number(headerValue(request.headers['content-length']));
    if (Number.isFinite(declaredLength) && declaredLength > DEFAULT_DATABASE_STORAGE_LIMITS.maxDatabaseBytes) {
      throw new Error('BACKUP_SIZE_INVALID');
    }
    const backup = await importBackupStream(
      this.config.dataDir,
      originalName,
      request,
      DEFAULT_DATABASE_STORAGE_LIMITS.maxDatabaseBytes,
    );
    this.#logStore.append({ source: 'server', level: 'info', event: 'backup.imported', requestId, code: `SCHEMA_${backup.schemaVersion}` });
    this.json(response, 201, { backup }, requestId);
  }

  private async stageRestore(request: IncomingMessage, response: ServerResponse, requestId: string): Promise<void> {
    const body = await this.readJson(request, 8 * 1024);
    if (!isRecord(body)) throw new Error('VALIDATION_ERROR');
    const importedName = safeBackupName(readString(body, 'name', 120));
    const confirmation = readString(body, 'confirmation', 40);
    if (confirmation !== RESTORE_CONFIRMATION) throw new Error('RESTORE_CONFIRMATION_REQUIRED');
    const preRestoreBackupName = `basketra-pre-restore-${Date.now()}.db`;
    const backupResponse = await this.fetchInner('/api/v1/backup', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: preRestoreBackupName }),
    });
    if (!backupResponse.ok) throw new Error('PRE_RESTORE_BACKUP_FAILED');
    const pending = await stagePendingRestore(this.config.dataDir, {
      importedName,
      preRestoreBackupName,
      confirmation,
      now: this.#clock(),
    });
    this.#logStore.append({ source: 'server', level: 'warn', event: 'restore.staged', requestId, code: 'RESTART_REQUIRED' });
    this.json(response, 202, { restore: { staged: true, pending, restartRequired: true } }, requestId);
    if (this.#requestRestart) {
      const timer = setTimeout(() => this.#requestRestart?.(), 250);
      timer.unref();
    }
  }

  private downloadBackup(response: ServerResponse, nameInput: string, requestId: string): void {
    const name = safeBackupName(nameInput);
    const path = join(resolve(this.config.dataDir), 'backups', name);
    if (!existsSync(path)) throw new Error('BACKUP_NOT_FOUND');
    const size = statSync(path).size;
    this.applyDirectSecurityHeaders(response, requestId);
    response.writeHead(200, {
      'content-type': 'application/vnd.sqlite3',
      'content-length': String(size),
      'content-disposition': `attachment; filename="${name}"`,
      'cache-control': 'private, no-store, max-age=0',
    });
    const stream = createReadStream(path);
    stream.on('error', () => {
      if (!response.headersSent) this.json(response, 500, { error: { code: 'BACKUP_READ_FAILED', requestId } }, requestId);
      else response.end();
    });
    stream.pipe(response);
    this.#logStore.append({ source: 'server', level: 'info', event: 'backup.downloaded', requestId });
  }

  private serveDirectAsset(response: ServerResponse, asset: string, requestId: string): void {
    const file = join(this.#publicDir, asset);
    if (!existsSync(file)) throw new Error('ASSET_NOT_FOUND');
    const contentType = extname(file) === '.js' ? 'text/javascript; charset=utf-8' : 'text/css; charset=utf-8';
    this.applyDirectSecurityHeaders(response, requestId);
    response.writeHead(200, { 'content-type': contentType, 'cache-control': 'no-cache' });
    response.end(readFileSync(file));
  }

  private proxy(request: IncomingMessage, response: ServerResponse, requestId: string, started: number): void {
    const upstream = httpRequest({
      host: '127.0.0.1',
      port: this.#innerPort,
      method: request.method ?? 'GET',
      path: request.url ?? '/',
      headers: request.headers,
    }, (upstreamResponse) => {
      const status = upstreamResponse.statusCode ?? 502;
      const headers = safeResponseHeaders(upstreamResponse.headers);
      response.writeHead(status, headers);
      upstreamResponse.pipe(response);
      response.once('close', () => {
        if (!upstreamResponse.destroyed) upstreamResponse.destroy();
      });
      if (status >= 400) {
        this.#logStore.append({
          source: 'server',
          level: status >= 500 ? 'error' : 'warn',
          event: 'http.request_failed',
          requestId: typeof headers['x-request-id'] === 'string' ? headers['x-request-id'] : requestId,
          method: request.method ?? 'UNKNOWN',
          path: (request.url ?? '/').split('?')[0]?.slice(0, 240) || '/',
          status,
          durationMs: Date.now() - started,
        });
      }
    });
    response.once('close', () => {
      if (!upstream.destroyed) upstream.destroy();
    });
    upstream.on('error', () => {
      this.#logStore.append({
        source: 'server',
        level: 'error',
        event: 'http.inner_unreachable',
        requestId,
        method: request.method ?? 'UNKNOWN',
        path: (request.url ?? '/').split('?')[0]?.slice(0, 240) || '/',
        code: 'INNER_UNREACHABLE',
        durationMs: Date.now() - started,
      });
      this.json(response, 502, { error: { code: 'INNER_UNREACHABLE', message: 'Application service is unavailable', requestId } }, requestId);
    });
    request.pipe(upstream);
  }

  private async fetchInner(path: string, init?: RequestInit): Promise<Response> {
    return fetch(`http://127.0.0.1:${this.#innerPort}${path}`, init);
  }

  private async readJson(request: IncomingMessage, maximumBytes: number): Promise<unknown> {
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    for await (const chunk of request) {
      const buffer = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
      bytes += buffer.byteLength;
      if (bytes > maximumBytes) throw new Error('REQUEST_TOO_LARGE');
      chunks.push(buffer);
    }
    if (chunks.length === 0) return {};
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  }

  private json(response: ServerResponse, status: number, body: unknown, requestId: string): void {
    if (response.headersSent) return;
    this.applyDirectSecurityHeaders(response, requestId);
    response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    response.end(JSON.stringify(body));
  }

  private applyDirectSecurityHeaders(response: ServerResponse, requestId: string): void {
    response.setHeader('x-request-id', requestId);
    response.setHeader('x-content-type-options', 'nosniff');
    response.setHeader('x-frame-options', 'DENY');
    response.setHeader('referrer-policy', 'no-referrer');
    response.setHeader('permissions-policy', 'camera=(self), microphone=(), geolocation=(self)');
    response.setHeader('content-security-policy', "default-src 'self'; connect-src 'self'; img-src 'self' blob: data:; style-src 'self'; script-src 'self'; worker-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
  }

  private errorMessage(code: string): string {
    switch (code) {
      case 'BACKUP_NOT_FOUND': return 'La copia de seguridad no existe';
      case 'BACKUP_NAME_INVALID': return 'El nombre de la copia no es válido';
      case 'BACKUP_CONTENT_TYPE_INVALID': return 'Selecciona un archivo SQLite .db válido';
      case 'BACKUP_SIZE_INVALID': return 'La copia está vacía o supera el límite de 512 MiB';
      case 'BACKUP_INTEGRITY_INVALID': return 'La copia no supera la comprobación de integridad SQLite';
      case 'BACKUP_SCHEMA_UNSUPPORTED': return 'La versión de base de datos de la copia no es compatible';
      case 'RESTORE_CONFIRMATION_REQUIRED': return `Escribe ${RESTORE_CONFIRMATION} para confirmar`;
      case 'IMPORTED_BACKUP_NOT_FOUND': return 'La copia importada ya no está disponible';
      case 'PRE_RESTORE_BACKUP_NOT_FOUND': return 'La copia previa a la restauración ya no está disponible';
      case 'PRE_RESTORE_BACKUP_FAILED': return 'No se pudo crear la copia previa a la restauración';
      case 'CLIENT_LOG_BATCH_INVALID': return 'El lote de logs del cliente no es válido';
      case 'LOG_LIMIT_INVALID': return 'El límite de logs no es válido';
      case 'REQUEST_TOO_LARGE': return 'La solicitud supera el límite permitido';
      default: return 'La operación no pudo completarse';
    }
  }
}
