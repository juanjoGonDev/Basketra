import { randomUUID } from 'node:crypto';
import { chmodSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const SQLITE_TEMP_PROBE_BYTES = 2 * 1024 * 1024;

export type RuntimeTempStorageMode = 'primary' | 'data-fallback';

export type RuntimeTempStorageSelection = Readonly<{
  mode: RuntimeTempStorageMode;
  directory: string;
}>;

export type RuntimeTempStorageOptions = Readonly<{
  writableProbe?: (directory: string) => void;
  sqliteProbe?: (directory: string) => Promise<void>;
}>;

function restoreEnvironment(name: 'SQLITE_TMPDIR' | 'TMPDIR', value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

export function probeWritableTempDirectory(directory: string): void {
  const probePath = join(resolve(directory), `.basketra-write-probe-${randomUUID()}`);
  try {
    writeFileSync(probePath, 'ok', { flag: 'wx', mode: 0o600 });
  } finally {
    rmSync(probePath, { force: true });
  }
}

export async function probeSqliteTempDirectory(directory: string): Promise<void> {
  const target = resolve(directory);
  const previousSqliteTmpDir = process.env['SQLITE_TMPDIR'];
  const previousTmpDir = process.env['TMPDIR'];
  process.env['SQLITE_TMPDIR'] = target;
  process.env['TMPDIR'] = target;

  let closeDatabase: (() => void) | undefined;
  try {
    const { DatabaseSync } = await import('node:sqlite');
    const database = new DatabaseSync(':memory:');
    closeDatabase = () => database.close();
    database.exec(
      'PRAGMA temp_store = FILE; PRAGMA temp.cache_size = 1; CREATE TEMP TABLE temp_probe(value BLOB);',
    );
    database.prepare('INSERT INTO temp_probe(value) VALUES (zeroblob(?))').run(SQLITE_TEMP_PROBE_BYTES);
    const row = database.prepare('SELECT length(value) AS bytes FROM temp_probe').get() as
      | { bytes: number }
      | undefined;
    if (row?.bytes !== SQLITE_TEMP_PROBE_BYTES) {
      throw new Error('SQLITE_TEMP_PROBE_INVALID_RESULT');
    }
  } finally {
    try {
      closeDatabase?.();
    } finally {
      restoreEnvironment('SQLITE_TMPDIR', previousSqliteTmpDir);
      restoreEnvironment('TMPDIR', previousTmpDir);
    }
  }
}

export async function prepareRuntimeTempStorage(
  preferredDirectory: string,
  dataDirectory: string,
  options: RuntimeTempStorageOptions = {},
): Promise<RuntimeTempStorageSelection> {
  const preferred = resolve(preferredDirectory);
  const fallback = resolve(join(dataDirectory, 'runtime-tmp'));
  const writableProbe = options.writableProbe ?? probeWritableTempDirectory;
  const sqliteProbe = options.sqliteProbe ?? probeSqliteTempDirectory;
  const previousSqliteTmpDir = process.env['SQLITE_TMPDIR'];
  const previousTmpDir = process.env['TMPDIR'];
  const candidates: readonly RuntimeTempStorageSelection[] = [
    { mode: 'primary', directory: preferred },
    ...(fallback === preferred ? [] : [{ mode: 'data-fallback' as const, directory: fallback }]),
  ];

  let selected: RuntimeTempStorageSelection | undefined;
  for (const candidate of candidates) {
    try {
      mkdirSync(candidate.directory, { recursive: true, mode: 0o700 });
      if (candidate.mode === 'data-fallback') chmodSync(candidate.directory, 0o700);
      writableProbe(candidate.directory);
      selected = candidate;
      break;
    } catch {
      // Try the next bounded candidate without exposing filesystem details.
    }
  }

  if (!selected) throw new Error('RUNTIME_TEMP_STORAGE_UNAVAILABLE');

  process.env['SQLITE_TMPDIR'] = selected.directory;
  process.env['TMPDIR'] = selected.directory;
  try {
    await sqliteProbe(selected.directory);
    return selected;
  } catch {
    restoreEnvironment('SQLITE_TMPDIR', previousSqliteTmpDir);
    restoreEnvironment('TMPDIR', previousTmpDir);
    throw new Error('RUNTIME_TEMP_STORAGE_UNAVAILABLE');
  }
}
