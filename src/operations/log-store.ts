import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export type LogSource = 'server' | 'client';
export type LogLevel = 'info' | 'warn' | 'error';

export type ApplicationLogEvent = Readonly<{
  timestamp: string;
  level: LogLevel;
  source: LogSource;
  event: string;
  requestId?: string;
  method?: string;
  path?: string;
  status?: number;
  durationMs?: number;
  code?: string;
}>;

export type LogStoreOptions = Readonly<{
  maxLines?: number;
  maxBytes?: number;
  maxFiles?: number;
  clock?: () => Date;
}>;

const DEFAULT_MAX_LINES = 10_000;
const DEFAULT_MAX_BYTES = 40 * 1024 * 1024;
const DEFAULT_MAX_FILES = 3;
const MAX_EVENT_BYTES = 2_048;
const EVENT_PATTERN = /^[a-z][a-z0-9_.-]{0,79}$/;
const CODE_PATTERN = /^[A-Z0-9_.-]{1,80}$/;
const REQUEST_ID_PATTERN = /^[a-f0-9-]{8,80}$/i;
const METHOD_PATTERN = /^[A-Z]{3,10}$/;

function positiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new RangeError(`${name} must be a positive safe integer`);
  return value;
}

function boundedInteger(value: unknown, minimum: number, maximum: number): number | undefined {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) return undefined;
  if (value < minimum || value > maximum) return undefined;
  return value;
}

function safeString(value: unknown, pattern: RegExp): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return pattern.test(trimmed) ? trimmed : undefined;
}

function safePath(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const path = value.trim();
  if (!path.startsWith('/') || path.length > 240 || /[\r\n?#]/.test(path)) return undefined;
  return path;
}

function parseLogLine(line: string): ApplicationLogEvent | undefined {
  try {
    const value = JSON.parse(line) as unknown;
    if (typeof value !== 'object' || value === null) return undefined;
    const record = value as Record<string, unknown>;
    if (record['source'] !== 'server' && record['source'] !== 'client') return undefined;
    if (record['level'] !== 'info' && record['level'] !== 'warn' && record['level'] !== 'error') return undefined;
    const event = safeString(record['event'], EVENT_PATTERN);
    const timestamp = typeof record['timestamp'] === 'string' ? record['timestamp'] : undefined;
    if (!event || !timestamp) return undefined;
    return value as ApplicationLogEvent;
  } catch {
    return undefined;
  }
}

export function sanitizeClientLog(value: unknown, timestamp: string): ApplicationLogEvent | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const record = value as Record<string, unknown>;
  const event = safeString(record['event'], EVENT_PATTERN);
  if (!event || !event.startsWith('client.')) return undefined;
  const level = record['level'] === 'error' || record['level'] === 'warn' ? record['level'] : 'info';
  const requestId = safeString(record['requestId'], REQUEST_ID_PATTERN);
  const method = safeString(record['method'], METHOD_PATTERN);
  const path = safePath(record['path']);
  const status = boundedInteger(record['status'], 100, 599);
  const durationMs = boundedInteger(record['durationMs'], 0, 300_000);
  const code = safeString(record['code'], CODE_PATTERN);
  return {
    timestamp,
    level,
    source: 'client',
    event,
    ...(requestId ? { requestId } : {}),
    ...(method ? { method } : {}),
    ...(path ? { path } : {}),
    ...(status !== undefined ? { status } : {}),
    ...(durationMs !== undefined ? { durationMs } : {}),
    ...(code ? { code } : {}),
  };
}

export class ApplicationLogStore {
  readonly #directory: string;
  readonly #currentPath: string;
  readonly #maxLines: number;
  readonly #maxBytes: number;
  readonly #maxFiles: number;
  readonly #clock: () => Date;
  #lineCount = 0;
  #byteCount = 0;

  constructor(dataDirectory: string, options: LogStoreOptions = {}) {
    this.#directory = join(dataDirectory, 'logs');
    this.#currentPath = join(this.#directory, 'application.ndjson');
    this.#maxLines = positiveInteger(options.maxLines ?? DEFAULT_MAX_LINES, 'maxLines');
    this.#maxBytes = positiveInteger(options.maxBytes ?? DEFAULT_MAX_BYTES, 'maxBytes');
    this.#maxFiles = positiveInteger(options.maxFiles ?? DEFAULT_MAX_FILES, 'maxFiles');
    this.#clock = options.clock ?? (() => new Date());
    mkdirSync(this.#directory, { recursive: true });
    this.loadCurrentCounters();
  }

  append(event: Omit<ApplicationLogEvent, 'timestamp'> & Readonly<{ timestamp?: string }>): void {
    const complete: ApplicationLogEvent = {
      ...event,
      timestamp: event.timestamp ?? this.#clock().toISOString(),
    };
    const line = `${JSON.stringify(complete)}\n`;
    const lineBytes = new TextEncoder().encode(line).byteLength;
    if (lineBytes > MAX_EVENT_BYTES) throw new RangeError('Application log event exceeds the maximum encoded size');
    if (this.#lineCount + 1 > this.#maxLines || this.#byteCount + lineBytes > this.#maxBytes) {
      this.rotate();
    }
    writeFileSync(this.#currentPath, line, { flag: 'a', mode: 0o600 });
    this.#lineCount += 1;
    this.#byteCount += lineBytes;
  }

  tail(limit: number, source?: LogSource): ApplicationLogEvent[] {
    const boundedLimit = Math.min(500, positiveInteger(limit, 'limit'));
    const paths: string[] = [];
    for (let index = this.#maxFiles - 1; index >= 1; index -= 1) {
      const path = this.archivePath(index);
      if (existsSync(path)) paths.push(path);
    }
    if (existsSync(this.#currentPath)) paths.push(this.#currentPath);
    const events: ApplicationLogEvent[] = [];
    for (const path of paths) {
      const text = Buffer.from(readFileSync(path)).toString('utf8');
      for (const line of text.split('\n')) {
        if (!line) continue;
        const event = parseLogLine(line);
        if (!event || (source && event.source !== source)) continue;
        events.push(event);
        if (events.length > boundedLimit) events.shift();
      }
    }
    return events;
  }

  private loadCurrentCounters(): void {
    if (!existsSync(this.#currentPath)) return;
    this.#byteCount = statSync(this.#currentPath).size;
    const text = Buffer.from(readFileSync(this.#currentPath)).toString('utf8');
    this.#lineCount = text.length === 0 ? 0 : text.split('\n').filter(Boolean).length;
  }

  private rotate(): void {
    rmSync(this.archivePath(this.#maxFiles - 1), { force: true });
    for (let index = this.#maxFiles - 2; index >= 1; index -= 1) {
      const source = this.archivePath(index);
      if (existsSync(source)) renameSync(source, this.archivePath(index + 1));
    }
    if (existsSync(this.#currentPath)) renameSync(this.#currentPath, this.archivePath(1));
    this.#lineCount = 0;
    this.#byteCount = 0;
  }

  private archivePath(index: number): string {
    return join(this.#directory, `application.${index}.ndjson`);
  }
}
