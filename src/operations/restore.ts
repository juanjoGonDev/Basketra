import { createHash, randomUUID } from 'node:crypto';
import { copyFileSync, createReadStream, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { CURRENT_SCHEMA_VERSION, validateBackup } from '../infrastructure/database.ts';

const BACKUP_NAME = /^[a-zA-Z0-9._-]+\.db$/;
const CONFIRMATION = 'RESTAURAR';
const MARKER_NAME = 'restore-pending.json';
const FAILED_MARKER_PREFIX = 'restore-failed-';

export type ImportedBackup = Readonly<{
  name: string;
  bytes: number;
  schemaVersion: number;
  sha256: string;
}>;

export type PendingRestore = Readonly<{
  version: 1;
  importedName: string;
  preRestoreBackupName: string;
  sha256: string;
  requestedAt: string;
}>;

export type RestoreStartupResult = Readonly<{
  status: 'none' | 'applied' | 'failed';
  importedName?: string;
  errorCode?: string;
}>;

function safeBackupName(name: string): string {
  const value = basename(name.trim());
  if (value !== name.trim() || !BACKUP_NAME.test(value) || value.length > 120) {
    throw new Error('BACKUP_NAME_INVALID');
  }
  return value;
}

function importedDirectory(dataDirectory: string): string {
  return join(resolve(dataDirectory), 'backups', 'imports');
}

function markerPath(dataDirectory: string): string {
  return join(resolve(dataDirectory), MARKER_NAME);
}

async function hashFile(path: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

function readPendingRestore(dataDirectory: string): PendingRestore {
  const raw = JSON.parse(Buffer.from(readFileSync(markerPath(dataDirectory))).toString('utf8')) as unknown;
  if (typeof raw !== 'object' || raw === null) throw new Error('RESTORE_MARKER_INVALID');
  const record = raw as Record<string, unknown>;
  if (record['version'] !== 1) throw new Error('RESTORE_MARKER_INVALID');
  if (typeof record['importedName'] !== 'string' || typeof record['preRestoreBackupName'] !== 'string') {
    throw new Error('RESTORE_MARKER_INVALID');
  }
  if (typeof record['sha256'] !== 'string' || !/^[a-f0-9]{64}$/.test(record['sha256'])) {
    throw new Error('RESTORE_MARKER_INVALID');
  }
  if (typeof record['requestedAt'] !== 'string') throw new Error('RESTORE_MARKER_INVALID');
  return {
    version: 1,
    importedName: safeBackupName(record['importedName']),
    preRestoreBackupName: safeBackupName(record['preRestoreBackupName']),
    sha256: record['sha256'],
    requestedAt: record['requestedAt'],
  };
}

export async function importBackupStream(
  dataDirectory: string,
  originalName: string,
  source: AsyncIterable<Uint8Array | string>,
  maxBytes: number,
): Promise<ImportedBackup> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) throw new RangeError('maxBytes must be a positive safe integer');
  safeBackupName(originalName);
  const directory = importedDirectory(dataDirectory);
  mkdirSync(directory, { recursive: true });
  const name = `import-${Date.now()}-${randomUUID()}.db`;
  const temporaryPath = join(directory, `${name}.partial`);
  const destinationPath = join(directory, name);
  const hash = createHash('sha256');
  let bytes = 0;
  let firstChunk = true;
  try {
    for await (const chunk of source) {
      const buffer = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
      bytes += buffer.byteLength;
      if (bytes > maxBytes) throw new Error('BACKUP_SIZE_INVALID');
      if (buffer.byteLength === 0) continue;
      writeFileSync(temporaryPath, buffer, { flag: firstChunk ? 'w' : 'a', mode: 0o600 });
      firstChunk = false;
      hash.update(buffer);
    }
    if (bytes === 0 || firstChunk) throw new Error('BACKUP_SIZE_INVALID');
    const validation = validateBackup(temporaryPath);
    if (!validation.valid) throw new Error('BACKUP_INTEGRITY_INVALID');
    if (validation.version < 1 || validation.version > CURRENT_SCHEMA_VERSION) {
      throw new Error('BACKUP_SCHEMA_UNSUPPORTED');
    }
    renameSync(temporaryPath, destinationPath);
    return {
      name,
      bytes,
      schemaVersion: validation.version,
      sha256: hash.digest('hex'),
    };
  } finally {
    rmSync(temporaryPath, { force: true });
  }
}

export async function listImportedBackups(dataDirectory: string): Promise<ImportedBackup[]> {
  const directory = importedDirectory(dataDirectory);
  mkdirSync(directory, { recursive: true });
  const backups: ImportedBackup[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isFile() || !BACKUP_NAME.test(entry.name)) continue;
    const path = join(directory, entry.name);
    const validation = validateBackup(path);
    if (!validation.valid || validation.version < 1 || validation.version > CURRENT_SCHEMA_VERSION) continue;
    backups.push({
      name: entry.name,
      bytes: statSync(path).size,
      schemaVersion: validation.version,
      sha256: await hashFile(path),
    });
  }
  return backups.sort((left, right) => right.name.localeCompare(left.name));
}

export async function stagePendingRestore(
  dataDirectory: string,
  input: Readonly<{
    importedName: string;
    preRestoreBackupName: string;
    confirmation: string;
    now?: Date;
  }>,
): Promise<PendingRestore> {
  if (input.confirmation !== CONFIRMATION) throw new Error('RESTORE_CONFIRMATION_REQUIRED');
  const importedName = safeBackupName(input.importedName);
  const preRestoreBackupName = safeBackupName(input.preRestoreBackupName);
  const sourcePath = join(importedDirectory(dataDirectory), importedName);
  const preRestorePath = join(resolve(dataDirectory), 'backups', preRestoreBackupName);
  if (!existsSync(sourcePath)) throw new Error('IMPORTED_BACKUP_NOT_FOUND');
  if (!existsSync(preRestorePath)) throw new Error('PRE_RESTORE_BACKUP_NOT_FOUND');
  const validation = validateBackup(sourcePath);
  if (!validation.valid || validation.version < 1 || validation.version > CURRENT_SCHEMA_VERSION) {
    throw new Error('BACKUP_SCHEMA_UNSUPPORTED');
  }
  const pending: PendingRestore = {
    version: 1,
    importedName,
    preRestoreBackupName,
    sha256: await hashFile(sourcePath),
    requestedAt: (input.now ?? new Date()).toISOString(),
  };
  const target = markerPath(dataDirectory);
  const temporary = `${target}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, `${JSON.stringify(pending)}\n`, { mode: 0o600 });
    renameSync(temporary, target);
  } finally {
    rmSync(temporary, { force: true });
  }
  return pending;
}

export async function applyPendingRestore(dataDirectory: string): Promise<RestoreStartupResult> {
  const marker = markerPath(dataDirectory);
  if (!existsSync(marker)) return { status: 'none' };
  let importedName: string | undefined;
  try {
    const pending = readPendingRestore(dataDirectory);
    importedName = pending.importedName;
    const sourcePath = join(importedDirectory(dataDirectory), pending.importedName);
    const preRestorePath = join(resolve(dataDirectory), 'backups', pending.preRestoreBackupName);
    if (!existsSync(sourcePath)) throw new Error('IMPORTED_BACKUP_NOT_FOUND');
    if (!existsSync(preRestorePath)) throw new Error('PRE_RESTORE_BACKUP_NOT_FOUND');
    if (await hashFile(sourcePath) !== pending.sha256) throw new Error('BACKUP_DIGEST_MISMATCH');
    const validation = validateBackup(sourcePath);
    if (!validation.valid || validation.version < 1 || validation.version > CURRENT_SCHEMA_VERSION) {
      throw new Error('BACKUP_SCHEMA_UNSUPPORTED');
    }
    const databasePath = join(resolve(dataDirectory), 'basketra.db');
    const temporaryPath = `${databasePath}.${randomUUID()}.restore`;
    try {
      copyFileSync(sourcePath, temporaryPath);
      const copiedValidation = validateBackup(temporaryPath);
      if (!copiedValidation.valid || copiedValidation.version !== validation.version) {
        throw new Error('BACKUP_COPY_INVALID');
      }
      rmSync(`${databasePath}-wal`, { force: true });
      rmSync(`${databasePath}-shm`, { force: true });
      renameSync(temporaryPath, databasePath);
    } finally {
      rmSync(temporaryPath, { force: true });
    }
    rmSync(marker, { force: true });
    return { status: 'applied', importedName: pending.importedName };
  } catch (error) {
    const failedMarker = join(resolve(dataDirectory), `${FAILED_MARKER_PREFIX}${Date.now()}.json`);
    try {
      renameSync(marker, failedMarker);
    } catch {
      rmSync(marker, { force: true });
    }
    return {
      status: 'failed',
      ...(importedName ? { importedName } : {}),
      errorCode: error instanceof Error ? error.message : 'RESTORE_UNKNOWN_FAILURE',
    };
  }
}

export const RESTORE_CONFIRMATION = CONFIRMATION;
