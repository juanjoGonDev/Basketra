import { createHash, randomUUID } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
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

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function importedDirectory(dataDirectory: string): string {
  return join(resolve(dataDirectory), 'backups', 'imports');
}

function markerPath(dataDirectory: string): string {
  return join(resolve(dataDirectory), MARKER_NAME);
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

export function importBackup(
  dataDirectory: string,
  input: Readonly<{ originalName: string; base64: string }>,
  maxBytes: number,
): ImportedBackup {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) throw new RangeError('maxBytes must be a positive safe integer');
  safeBackupName(input.originalName);
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(input.base64) || input.base64.length % 4 !== 0) {
    throw new Error('BACKUP_BASE64_INVALID');
  }
  const bytes = Buffer.from(input.base64, 'base64');
  if (bytes.byteLength === 0 || bytes.byteLength > maxBytes) throw new Error('BACKUP_SIZE_INVALID');
  const directory = importedDirectory(dataDirectory);
  mkdirSync(directory, { recursive: true });
  const name = `import-${Date.now()}-${randomUUID()}.db`;
  const temporaryPath = join(directory, `${name}.partial`);
  const destinationPath = join(directory, name);
  try {
    writeFileSync(temporaryPath, bytes, { mode: 0o600 });
    const validation = validateBackup(temporaryPath);
    if (!validation.valid) throw new Error('BACKUP_INTEGRITY_INVALID');
    if (validation.version < 1 || validation.version > CURRENT_SCHEMA_VERSION) {
      throw new Error('BACKUP_SCHEMA_UNSUPPORTED');
    }
    renameSync(temporaryPath, destinationPath);
    return {
      name,
      bytes: bytes.byteLength,
      schemaVersion: validation.version,
      sha256: sha256(bytes),
    };
  } finally {
    rmSync(temporaryPath, { force: true });
  }
}

export function listImportedBackups(dataDirectory: string): ImportedBackup[] {
  const directory = importedDirectory(dataDirectory);
  mkdirSync(directory, { recursive: true });
  return readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && BACKUP_NAME.test(entry.name))
    .map((entry) => {
      const path = join(directory, entry.name);
      const bytes = readFileSync(path);
      const validation = validateBackup(path);
      return {
        name: entry.name,
        bytes: statSync(path).size,
        schemaVersion: validation.version,
        sha256: sha256(bytes),
      };
    })
    .filter((backup) => backup.schemaVersion >= 1 && backup.schemaVersion <= CURRENT_SCHEMA_VERSION)
    .sort((left, right) => right.name.localeCompare(left.name));
}

export function stagePendingRestore(
  dataDirectory: string,
  input: Readonly<{
    importedName: string;
    preRestoreBackupName: string;
    confirmation: string;
    now?: Date;
  }>,
): PendingRestore {
  if (input.confirmation !== CONFIRMATION) throw new Error('RESTORE_CONFIRMATION_REQUIRED');
  const importedName = safeBackupName(input.importedName);
  const preRestoreBackupName = safeBackupName(input.preRestoreBackupName);
  const sourcePath = join(importedDirectory(dataDirectory), importedName);
  if (!existsSync(sourcePath)) throw new Error('IMPORTED_BACKUP_NOT_FOUND');
  const bytes = readFileSync(sourcePath);
  const validation = validateBackup(sourcePath);
  if (!validation.valid || validation.version < 1 || validation.version > CURRENT_SCHEMA_VERSION) {
    throw new Error('BACKUP_SCHEMA_UNSUPPORTED');
  }
  const pending: PendingRestore = {
    version: 1,
    importedName,
    preRestoreBackupName,
    sha256: sha256(bytes),
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

export function applyPendingRestore(dataDirectory: string): RestoreStartupResult {
  const marker = markerPath(dataDirectory);
  if (!existsSync(marker)) return { status: 'none' };
  let importedName: string | undefined;
  try {
    const pending = readPendingRestore(dataDirectory);
    importedName = pending.importedName;
    const sourcePath = join(importedDirectory(dataDirectory), pending.importedName);
    if (!existsSync(sourcePath)) throw new Error('IMPORTED_BACKUP_NOT_FOUND');
    const sourceBytes = readFileSync(sourcePath);
    if (sha256(sourceBytes) !== pending.sha256) throw new Error('BACKUP_DIGEST_MISMATCH');
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
