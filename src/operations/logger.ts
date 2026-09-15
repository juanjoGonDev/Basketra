import type { ApplicationLogEvent, ApplicationLogStore, LogLevel } from './log-store.ts';

type LogOutput = Readonly<{ write(value: string): boolean; isTTY?: boolean }>;

export type LoggerMeta = Readonly<{
  requestId?: string;
  method?: string;
  path?: string;
  status?: number;
  durationMs?: number;
  code?: string;
}>;

export type ApplicationLoggerOptions = Readonly<{
  clock?: () => Date;
  output?: LogOutput;
  errorOutput?: LogOutput;
  context?: string;
  duplicateWindowMs?: number;
}>;

const LEVEL_LABEL: Record<LogLevel, string> = {
  trace: 'TRACE', debug: 'DEBUG', info: 'INFO', success: 'SUCCESS', warn: 'WARN', error: 'ERROR', tool: 'TOOL',
};
const LEVEL_COLOR: Record<LogLevel, string> = {
  trace: '\u001b[90m', debug: '\u001b[36m', info: '\u001b[34m', success: '\u001b[32m', warn: '\u001b[33m', error: '\u001b[31m', tool: '\u001b[35m',
};
const RESET = '\u001b[0m';
const CONTEXT_PATTERN = /^[A-Za-z][A-Za-z0-9 _.-]{0,63}$/;

function formatTimestamp(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function safeContext(value: string): string {
  const trimmed = value.trim();
  if (!CONTEXT_PATTERN.test(trimmed)) throw new RangeError('Logger context must be a bounded safe label');
  return trimmed;
}

/** Dependency-free, redacted server logger modelled after WebAPI's terminal logger. */
export class ApplicationLogger {
  readonly #store: ApplicationLogStore;
  readonly #clock: () => Date;
  readonly #output: LogOutput;
  readonly #errorOutput: LogOutput;
  readonly #context?: string;
  readonly #duplicateWindowMs: number;
  readonly #duplicates: Map<string, { at: number; count: number }>;

  constructor(store: ApplicationLogStore, options: ApplicationLoggerOptions = {}, duplicates = new Map<string, { at: number; count: number }>()) {
    this.#store = store;
    this.#clock = options.clock ?? (() => new Date());
    this.#output = options.output ?? (process as unknown as { stdout: LogOutput }).stdout;
    this.#errorOutput = options.errorOutput ?? (process as unknown as { stderr: LogOutput }).stderr;
    if (options.context) this.#context = safeContext(options.context);
    this.#duplicateWindowMs = options.duplicateWindowMs ?? 1_500;
    this.#duplicates = duplicates;
  }

  child(context: string): ApplicationLogger {
    return new ApplicationLogger(this.#store, {
      clock: this.#clock, output: this.#output, errorOutput: this.#errorOutput, context: context,
      duplicateWindowMs: this.#duplicateWindowMs,
    }, this.#duplicates);
  }

  trace(event: string, meta?: LoggerMeta): void { this.write('trace', event, meta); }
  debug(event: string, meta?: LoggerMeta): void { this.write('debug', event, meta); }
  info(event: string, meta?: LoggerMeta): void { this.write('info', event, meta); }
  success(event: string, meta?: LoggerMeta): void { this.write('success', event, meta); }
  warn(event: string, meta?: LoggerMeta): void { this.write('warn', event, meta); }
  error(event: string, meta?: LoggerMeta): void { this.write('error', event, meta); }
  tool(event: string, meta?: LoggerMeta): void { this.write('tool', event, meta); }

  private write(level: LogLevel, event: string, meta: LoggerMeta = {}): void {
    const now = this.#clock();
    const base: Omit<ApplicationLogEvent, 'timestamp'> = {
      source: 'server', level, event,
      ...(this.#context ? { context: this.#context } : {}),
      ...meta,
    };
    const key = JSON.stringify(base);
    const previous = this.#duplicates.get(key);
    const timestamp = now.getTime();
    if (previous && timestamp - previous.at <= this.#duplicateWindowMs) {
      previous.at = timestamp;
      previous.count += 1;
      return;
    }
    const suppressedDuplicates = previous?.count ?? 0;
    this.#duplicates.set(key, { at: timestamp, count: 0 });
    const eventWithDuplicate = suppressedDuplicates > 0 ? { ...base, suppressedDuplicates } : base;
    this.#store.append({ ...eventWithDuplicate, timestamp: now.toISOString() });
    const output = level === 'warn' || level === 'error' ? this.#errorOutput : this.#output;
    output.write(`${this.format(level, event, eventWithDuplicate, now)}\n`);
  }

  private format(level: LogLevel, event: string, meta: Omit<ApplicationLogEvent, 'timestamp'>, date: Date): string {
    const detail = [
      meta.requestId ? `[${meta.requestId.slice(0, 8)}]` : '',
      event,
      meta.method ? `${meta.method}${meta.status ? ` ${meta.status}` : ''}` : meta.status ? String(meta.status) : '',
      meta.path ?? '',
      meta.durationMs === undefined ? '' : `${meta.durationMs}ms`,
      meta.code ? `(${meta.code})` : '',
      meta.suppressedDuplicates ? `+${meta.suppressedDuplicates} duplicados` : '',
    ].filter(Boolean).join(' ');
    const context = this.#context ? ` [${this.#context}]` : '';
    const label = LEVEL_LABEL[level].padEnd(7);
    if (!outputSupportsColor(this.#output, this.#errorOutput, level)) return `${formatTimestamp(date)} ${label}${context} ${detail}`;
    return `\u001b[90m${formatTimestamp(date).slice(0, 10)}${RESET} \u001b[36m${formatTimestamp(date).slice(11)}${RESET} ${LEVEL_COLOR[level]}\u001b[1m${label}${RESET}\u001b[90m${context}${RESET} ${detail}`;
  }
}

function outputSupportsColor(output: LogOutput, errorOutput: LogOutput, level: LogLevel): boolean {
  return Boolean((level === 'warn' || level === 'error' ? errorOutput : output).isTTY);
}
