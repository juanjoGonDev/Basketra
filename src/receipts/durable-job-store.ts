import { DatabaseSync } from 'node:sqlite';
import type { ReceiptPageEvidence } from './service.ts';

export const RECEIPT_DURABLE_JOB_PHASES = [
  'queued',
  'ocr_running',
  'ai_pending',
  'ai_running',
  'completed',
  'failed',
  'cancelled',
] as const;
export type ReceiptDurableJobPhase = typeof RECEIPT_DURABLE_JOB_PHASES[number];

export const RECEIPT_REMOTE_RESPONSE_STATUSES = [
  'queued',
  'in_progress',
  'completed',
  'failed',
  'cancelled',
  'incomplete',
] as const;
export type ReceiptRemoteResponseStatus = typeof RECEIPT_REMOTE_RESPONSE_STATUSES[number];

export type PersistedReceiptOcrPage = Omit<ReceiptPageEvidence, 'ai'>;

export type ReceiptDurablePageState = Readonly<{
  position: number;
  ocr?: PersistedReceiptOcrPage;
  idempotencyKey?: string;
  responseId?: string;
  remoteStatus?: ReceiptRemoteResponseStatus;
  remoteResult?: unknown;
  remoteErrorCode?: string;
}>;

export type ReceiptDurableJobState = Readonly<{
  jobId: string;
  generation: number;
  phase: ReceiptDurableJobPhase;
  deadlineAt: string;
  pageCount: number;
  pages: readonly ReceiptDurablePageState[];
}>;

const MAX_CHECKPOINT_JSON_BYTES = 2 * 1024 * 1024;
const RESPONSE_ID_PATTERN = /^resp_[A-Za-z0-9]{7,128}$/u;

export class ReceiptDurableJobStore {
  readonly #database: DatabaseSync;
  readonly #clock: () => Date;

  constructor(
    path: string,
    options: Readonly<{ clock?: () => Date }> = {},
  ) {
    this.#clock = options.clock ?? (() => new Date());
    this.#database = new DatabaseSync(path);
    this.#database.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
  }

  initialize(
    jobId: string,
    input: Readonly<{
      deadlineAt: string;
      generation: number;
      pageCount: number;
    }>,
  ): Omit<ReceiptDurableJobState, 'pages'> {
    assertJobId(jobId);
    assertPositiveInteger(input.generation, 'generation');
    if (!Number.isSafeInteger(input.pageCount) || input.pageCount < 1 || input.pageCount > 20) {
      throw new RangeError('pageCount must be between one and twenty');
    }
    assertIsoTimestamp(input.deadlineAt, 'deadlineAt');

    const existing = this.getHeader(jobId);
    if (existing) {
      if (
        existing.generation !== input.generation
        || existing.pageCount !== input.pageCount
        || existing.deadlineAt !== input.deadlineAt
      ) {
        throw new Error('Receipt durable job is already initialized with different immutable metadata');
      }
      return existing;
    }

    const timestamp = this.#clock().toISOString();
    this.#database.exec('BEGIN IMMEDIATE');
    try {
      this.#database.prepare(`
        INSERT INTO receipt_extraction_job_state(
          job_id, generation, phase, deadline_at, page_count, created_at, updated_at
        ) VALUES (?, ?, 'queued', ?, ?, ?, ?)
      `).run(jobId, input.generation, input.deadlineAt, input.pageCount, timestamp, timestamp);
      const insertPage = this.#database.prepare(`
        INSERT INTO receipt_extraction_job_pages(job_id, position, updated_at)
        VALUES (?, ?, ?)
      `);
      for (let position = 0; position < input.pageCount; position += 1) {
        insertPage.run(jobId, position, timestamp);
      }
      this.#database.exec('COMMIT');
    } catch (error) {
      this.#database.exec('ROLLBACK');
      throw error;
    }
    return requireHeader(this.getHeader(jobId));
  }

  get(jobId: string): ReceiptDurableJobState | undefined {
    const header = this.getHeader(jobId);
    if (!header) return undefined;
    const rows = this.#database.prepare(`
      SELECT position, ocr_json AS ocrJson, idempotency_key AS idempotencyKey,
        response_id AS responseId, remote_status AS remoteStatus,
        remote_result_json AS remoteResultJson, remote_error_code AS remoteErrorCode
      FROM receipt_extraction_job_pages
      WHERE job_id = ?
      ORDER BY position ASC
    `).all(jobId) as Array<{
      position: number;
      ocrJson: string | null;
      idempotencyKey: string | null;
      responseId: string | null;
      remoteStatus: ReceiptRemoteResponseStatus | null;
      remoteResultJson: string | null;
      remoteErrorCode: string | null;
    }>;
    if (rows.length !== header.pageCount) {
      throw new Error('Receipt durable page checkpoint count does not match job metadata');
    }
    return {
      ...header,
      pages: rows.map((row) => ({
        position: row.position,
        ...(row.ocrJson === null ? {} : { ocr: parseOcrPage(row.ocrJson) }),
        ...(row.idempotencyKey === null ? {} : { idempotencyKey: row.idempotencyKey }),
        ...(row.responseId === null ? {} : { responseId: row.responseId }),
        ...(row.remoteStatus === null ? {} : { remoteStatus: row.remoteStatus }),
        ...(row.remoteResultJson === null ? {} : { remoteResult: parseJson(row.remoteResultJson) }),
        ...(row.remoteErrorCode === null ? {} : { remoteErrorCode: row.remoteErrorCode }),
      })),
    };
  }

  listRecoverableJobIds(): string[] {
    const rows = this.#database.prepare(`
      SELECT state.job_id AS jobId
      FROM receipt_extraction_job_state AS state
      INNER JOIN receipt_extraction_jobs AS jobs ON jobs.id = state.job_id
      WHERE jobs.status IN ('queued', 'running')
        AND state.phase IN ('queued', 'ocr_running', 'ai_pending', 'ai_running')
      ORDER BY jobs.created_at ASC, state.job_id ASC
    `).all() as Array<{ jobId: string }>;
    return rows.map((row) => row.jobId);
  }

  recoverNonDurableActiveJobs(): number {
    const timestamp = this.#clock().toISOString();
    const result = this.#database.prepare(`
      UPDATE receipt_extraction_jobs
      SET status = 'failed', error_code = 'RECEIPT_EXTRACTION_INTERRUPTED',
        updated_at = ?, completed_at = ?
      WHERE status IN ('queued', 'running')
        AND NOT EXISTS (
          SELECT 1
          FROM receipt_extraction_job_state AS state
          WHERE state.job_id = receipt_extraction_jobs.id
        )
    `).run(timestamp, timestamp);
    return Number(result.changes);
  }

  markPhase(jobId: string, phase: ReceiptDurableJobPhase): void {
    if (!RECEIPT_DURABLE_JOB_PHASES.includes(phase)) {
      throw new RangeError('Unsupported receipt durable job phase');
    }
    const result = this.#database.prepare(`
      UPDATE receipt_extraction_job_state
      SET phase = ?, updated_at = ?
      WHERE job_id = ?
    `).run(phase, this.#clock().toISOString(), jobId);
    if (Number(result.changes) !== 1) throw new Error('Receipt durable job was not found');
  }

  saveOcrPage(jobId: string, position: number, page: PersistedReceiptOcrPage): void {
    const serialized = serializeBounded(page, 'OCR checkpoint');
    const result = this.#database.prepare(`
      UPDATE receipt_extraction_job_pages
      SET ocr_json = COALESCE(ocr_json, ?), updated_at = ?
      WHERE job_id = ? AND position = ?
    `).run(serialized, this.#clock().toISOString(), jobId, position);
    if (Number(result.changes) !== 1) throw new Error('Receipt durable page was not found');
  }

  ensureIdempotencyKey(jobId: string, position: number): string {
    const state = requireState(this.get(jobId));
    const page = requirePage(state, position);
    if (page.idempotencyKey) return page.idempotencyKey;
    const key = `basketra-receipt:${jobId}:g${String(state.generation)}:p${String(position)}`;
    if (key.length > 128) throw new Error('Receipt idempotency key exceeds provider limit');
    const result = this.#database.prepare(`
      UPDATE receipt_extraction_job_pages
      SET idempotency_key = ?, updated_at = ?
      WHERE job_id = ? AND position = ? AND idempotency_key IS NULL
    `).run(key, this.#clock().toISOString(), jobId, position);
    if (Number(result.changes) === 0) {
      return requirePage(requireState(this.get(jobId)), position).idempotencyKey
        ?? (() => { throw new Error('Receipt idempotency key was not persisted'); })();
    }
    return key;
  }

  saveRemoteIdentity(
    jobId: string,
    position: number,
    input: Readonly<{
      responseId: string;
      status: ReceiptRemoteResponseStatus;
    }>,
  ): void {
    assertResponseId(input.responseId);
    assertRemoteStatus(input.status);
    const current = requirePage(requireState(this.get(jobId)), position);
    if (current.responseId && current.responseId !== input.responseId) {
      throw new Error('Receipt durable page is already bound to another remote response');
    }
    this.#database.prepare(`
      UPDATE receipt_extraction_job_pages
      SET response_id = COALESCE(response_id, ?), remote_status = ?,
        remote_error_code = NULL, updated_at = ?
      WHERE job_id = ? AND position = ?
    `).run(input.responseId, input.status, this.#clock().toISOString(), jobId, position);
  }

  saveRemoteStatus(
    jobId: string,
    position: number,
    status: ReceiptRemoteResponseStatus,
  ): void {
    assertRemoteStatus(status);
    const result = this.#database.prepare(`
      UPDATE receipt_extraction_job_pages
      SET remote_status = ?, updated_at = ?
      WHERE job_id = ? AND position = ?
    `).run(status, this.#clock().toISOString(), jobId, position);
    if (Number(result.changes) !== 1) throw new Error('Receipt durable page was not found');
  }

  saveRemoteResult(
    jobId: string,
    position: number,
    input: Readonly<{
      responseId: string;
      status: 'completed';
      interpretation: unknown;
    }>,
  ): void {
    assertResponseId(input.responseId);
    const result = serializeBounded(input.interpretation, 'Remote receipt result');
    const current = requirePage(requireState(this.get(jobId)), position);
    if (current.responseId && current.responseId !== input.responseId) {
      throw new Error('Receipt durable page result belongs to another remote response');
    }
    this.#database.prepare(`
      UPDATE receipt_extraction_job_pages
      SET response_id = COALESCE(response_id, ?), remote_status = 'completed',
        remote_result_json = ?, remote_error_code = NULL, updated_at = ?
      WHERE job_id = ? AND position = ?
    `).run(input.responseId, result, this.#clock().toISOString(), jobId, position);
  }

  saveRemoteFailure(
    jobId: string,
    position: number,
    input: Readonly<{
      status: Exclude<ReceiptRemoteResponseStatus, 'queued' | 'in_progress' | 'completed'>;
      errorCode: string;
    }>,
  ): void {
    assertRemoteStatus(input.status);
    if (!/^[A-Z0-9_.-]{1,80}$/u.test(input.errorCode)) {
      throw new RangeError('Remote receipt error code is invalid');
    }
    const result = this.#database.prepare(`
      UPDATE receipt_extraction_job_pages
      SET remote_status = ?, remote_error_code = ?, updated_at = ?
      WHERE job_id = ? AND position = ?
    `).run(input.status, input.errorCode, this.#clock().toISOString(), jobId, position);
    if (Number(result.changes) !== 1) throw new Error('Receipt durable page was not found');
  }

  close(): void {
    this.#database.close();
  }

  private getHeader(jobId: string): Omit<ReceiptDurableJobState, 'pages'> | undefined {
    const row = this.#database.prepare(`
      SELECT job_id AS jobId, generation, phase, deadline_at AS deadlineAt,
        page_count AS pageCount
      FROM receipt_extraction_job_state
      WHERE job_id = ?
    `).get(jobId) as {
      jobId: string;
      generation: number;
      phase: ReceiptDurableJobPhase;
      deadlineAt: string;
      pageCount: number;
    } | undefined;
    return row;
  }
}

function parseJson(value: string): unknown {
  if (Buffer.byteLength(value) > MAX_CHECKPOINT_JSON_BYTES) {
    throw new Error('Receipt durable JSON exceeds its storage bound');
  }
  return JSON.parse(value) as unknown;
}

function parseOcrPage(value: string): PersistedReceiptOcrPage {
  const parsed = parseJson(value);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('Receipt OCR checkpoint is malformed');
  }
  const page = parsed as Partial<PersistedReceiptOcrPage>;
  if (
    !Number.isSafeInteger(page.position)
    || typeof page.storageKey !== 'string'
    || typeof page.mimeType !== 'string'
    || typeof page.text !== 'string'
    || typeof page.confidence !== 'number'
    || typeof page.source !== 'string'
    || typeof page.deterministic !== 'object'
    || page.deterministic === null
  ) {
    throw new Error('Receipt OCR checkpoint is malformed');
  }
  return parsed as PersistedReceiptOcrPage;
}

function serializeBounded(value: unknown, label: string): string {
  const serialized = JSON.stringify(value);
  if (Buffer.byteLength(serialized) > MAX_CHECKPOINT_JSON_BYTES) {
    throw new RangeError(`${label} exceeds the durable storage limit`);
  }
  return serialized;
}

function assertPositiveInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new RangeError(`${name} must be a positive safe integer`);
  }
}

function assertJobId(value: string): void {
  if (!/^[A-Za-z0-9_-]{8,128}$/u.test(value)) {
    throw new RangeError('Receipt job id is invalid');
  }
}

function assertIsoTimestamp(value: string, name: string): void {
  if (!Number.isFinite(Date.parse(value))) throw new RangeError(`${name} must be an ISO timestamp`);
}

function assertResponseId(value: string): void {
  if (!RESPONSE_ID_PATTERN.test(value)) throw new RangeError('Remote response id is invalid');
}

function assertRemoteStatus(value: ReceiptRemoteResponseStatus): void {
  if (!RECEIPT_REMOTE_RESPONSE_STATUSES.includes(value)) {
    throw new RangeError('Remote response status is invalid');
  }
}

function requireHeader(
  value: Omit<ReceiptDurableJobState, 'pages'> | undefined,
): Omit<ReceiptDurableJobState, 'pages'> {
  if (!value) throw new Error('Receipt durable job was not persisted');
  return value;
}

function requireState(value: ReceiptDurableJobState | undefined): ReceiptDurableJobState {
  if (!value) throw new Error('Receipt durable job was not found');
  return value;
}

function requirePage(state: ReceiptDurableJobState, position: number): ReceiptDurablePageState {
  const page = state.pages[position];
  if (!page || page.position !== position) throw new Error('Receipt durable page was not found');
  return page;
}
