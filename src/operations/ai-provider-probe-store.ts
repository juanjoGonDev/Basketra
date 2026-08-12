import { DatabaseSync } from 'node:sqlite';
import { join, resolve } from 'node:path';
import { createId } from '../infrastructure/ids.ts';

const PROBE_OPERATION = 'provider-capability-probe';
const MAX_METADATA_CHARS = 2_000;

export type AiProviderProbeTrigger = 'startup' | 'manual';

export type AiProviderProbeRecord = Readonly<{
  checkedAt: string;
  durationMs: number;
  status: 'success' | 'error';
  trigger: AiProviderProbeTrigger;
  errorCode?: string;
  connection?: Readonly<{
    imageStructuredOutput?: boolean;
    model?: string;
    ok: true;
  }>;
}>;

export class AiProviderProbeStore {
  readonly #database: DatabaseSync;
  readonly #clock: () => Date;

  constructor(dataDir: string, clock: () => Date = () => new Date()) {
    this.#clock = clock;
    this.#database = new DatabaseSync(resolve(join(dataDir, 'basketra.db')));
    this.#database.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
    const table = this.#database
      .prepare("SELECT 1 AS present FROM sqlite_master WHERE type='table' AND name='ai_executions'")
      .get() as { present: number } | undefined;
    if (table?.present !== 1) {
      this.#database.close();
      throw new Error('ai_executions table is unavailable');
    }
  }

  close(): void {
    this.#database.close();
  }

  latest(): AiProviderProbeRecord | undefined {
    const row = this.#database.prepare(`
      SELECT status, duration_ms, error_code, metadata_json, created_at
      FROM ai_executions
      WHERE operation = ?
      ORDER BY created_at DESC, id DESC
      LIMIT 1
    `).get(PROBE_OPERATION) as {
      status: string;
      duration_ms: number;
      error_code: string | null;
      metadata_json: string;
      created_at: string;
    } | undefined;

    if (!row || (row.status !== 'success' && row.status !== 'error')) return undefined;
    const metadata = parseMetadata(row.metadata_json);
    const trigger = metadata['trigger'] === 'startup' ? 'startup' : 'manual';
    const connection = parseConnection(metadata['connection']);
    return {
      checkedAt: row.created_at,
      durationMs: Math.max(0, Number(row.duration_ms) || 0),
      status: row.status,
      trigger,
      ...(row.error_code ? { errorCode: row.error_code.slice(0, 80) } : {}),
      ...(connection ? { connection } : {}),
    };
  }

  recordSuccess(
    trigger: AiProviderProbeTrigger,
    durationMs: number,
    connection: Readonly<{ ok: true; model?: string; imageStructuredOutput?: boolean }>,
  ): AiProviderProbeRecord {
    const checkedAt = this.#clock().toISOString();
    const metadata = JSON.stringify({
      trigger,
      connection: {
        ok: true,
        ...(connection.model ? { model: connection.model.slice(0, 160) } : {}),
        ...(connection.imageStructuredOutput === undefined
          ? {}
          : { imageStructuredOutput: connection.imageStructuredOutput }),
      },
    });
    this.insert('success', durationMs, undefined, metadata, checkedAt);
    return {
      checkedAt,
      durationMs: normalizeDuration(durationMs),
      status: 'success',
      trigger,
      connection,
    };
  }

  recordFailure(
    trigger: AiProviderProbeTrigger,
    durationMs: number,
    errorCode: string,
  ): AiProviderProbeRecord {
    const checkedAt = this.#clock().toISOString();
    const boundedCode = /^[A-Z0-9_.-]{1,80}$/u.test(errorCode)
      ? errorCode
      : 'AI_PROVIDER_FAILED';
    this.insert(
      'error',
      durationMs,
      boundedCode,
      JSON.stringify({ trigger }),
      checkedAt,
    );
    return {
      checkedAt,
      durationMs: normalizeDuration(durationMs),
      errorCode: boundedCode,
      status: 'error',
      trigger,
    };
  }

  private insert(
    status: 'success' | 'error',
    durationMs: number,
    errorCode: string | undefined,
    metadata: string,
    createdAt: string,
  ): void {
    if (metadata.length > MAX_METADATA_CHARS) throw new Error('AI probe metadata exceeds bounded storage');
    this.#database.prepare(`
      INSERT INTO ai_executions(
        id, operation, provider_id, status, attempts, duration_ms,
        error_code, metadata_json, created_at
      ) VALUES (?, ?, NULL, ?, 1, ?, ?, ?, ?)
    `).run(
      createId('aie'),
      PROBE_OPERATION,
      status,
      normalizeDuration(durationMs),
      errorCode ?? null,
      metadata,
      createdAt,
    );
  }
}

function normalizeDuration(value: number): number {
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function parseMetadata(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown;
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function parseConnection(value: unknown): AiProviderProbeRecord['connection'] | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  if (record['ok'] !== true) return undefined;
  const model = typeof record['model'] === 'string' && record['model'].length <= 160
    ? record['model']
    : undefined;
  const imageStructuredOutput = typeof record['imageStructuredOutput'] === 'boolean'
    ? record['imageStructuredOutput']
    : undefined;
  return {
    ok: true,
    ...(model ? { model } : {}),
    ...(imageStructuredOutput === undefined ? {} : { imageStructuredOutput }),
  };
}
