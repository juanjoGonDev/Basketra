import { DatabaseSync } from 'node:sqlite';
import { chmodSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const SQLITE_TEMP_PROBE_BYTES = 2 * 1024 * 1024;

export type RuntimeTempStorageMode = 'primary' | 'data-fallback';

export type RuntimeTempStorageSelection = Readonly<{
  mode: RuntimeTempStorageMode;
  directory: string;
}>;

export type RuntimeTempStorageOptions = Readonly<{
  probe?: (directory: string) => void;
}>;

function restoreEnvironment(name: 'SQLITE_TMPDIR' | 'TMPDIR', value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

export function probeSqliteTempDirectory(directory: string): void {
  const target = resolve(directory);
  const previousSqliteTmpDir = process.env['SQLITE_TMPDIR'];
  const previousTmpDir = process.env['TMPDIR'];
  process.env['SQLITE_TMPDIR'] = target;
  process.env['TMPDIR'] = target;

  let database: DatabaseSync | undefined;
  try {
    database = new DatabaseSync(':memory:');
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
      database?.close();
    } finally {
      restoreEnvironment('SQLITE_TMPDIR', previousSqliteTmpDir);
      restoreEnvironment('TMPDIR', previousTmpDir);
    }
  }
}

export function prepareRuntimeTempStorage(
  preferredDirectory: string,
  dataDirectory: string,
  options: RuntimeTempStorageOptions = {},
): RuntimeTempStorageSelection {
  const preferred = resolve(preferredDirectory);
  const fallback = resolve(join(dataDirectory, 'runtime-tmp'));
  const probe = options.probe ?? probeSqliteTempDirectory;
  const candidates: readonly RuntimeTempStorageSelection[] = [
    { mode: 'primary', directory: preferred },
    ...(fallback === preferred ? [] : [{ mode: 'data-fallback' as const, directory: fallback }]),
  ];

  for (const candidate of candidates) {
    try {
      mkdirSync(candidate.directory, { recursive: true, mode: 0o700 });
      if (candidate.mode === 'data-fallback') chmodSync(candidate.directory, 0o700);
      probe(candidate.directory);
      process.env['SQLITE_TMPDIR'] = candidate.directory;
      process.env['TMPDIR'] = candidate.directory;
      return candidate;
    } catch {
      // Try the next bounded candidate without exposing filesystem details.
    }
  }

  throw new Error('RUNTIME_TEMP_STORAGE_UNAVAILABLE');
}
