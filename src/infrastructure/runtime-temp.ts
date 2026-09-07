import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { chmodSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SQLITE_TEMP_PROBE_BYTES = 2 * 1024 * 1024;
const ISOLATED_PROBE_SCRIPT = fileURLToPath(
  new URL('../../scripts/sqlite-temp-probe.mjs', import.meta.url),
);

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

export async function probeSqliteTempDirectoryIsolated(directory: string): Promise<void> {
  const target = resolve(directory);
  await new Promise<void>((resolvePromise, reject) => {
    const child = spawn(
      process.execPath,
      [...process.execArgv, ISOLATED_PROBE_SCRIPT, '--isolated'],
      {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: {
          ...process.env,
          SQLITE_TMPDIR: target,
          TMPDIR: target,
        },
      },
    );
    child.stdin.end();
    child.stdout.on('data', () => undefined);
    child.stderr.on('data', () => undefined);
    child.once('error', () => reject(new Error('SQLITE_TEMP_PROBE_PROCESS_FAILED')));
    child.once('close', (code) => {
      if (code === 0) resolvePromise();
      else reject(new Error('SQLITE_TEMP_PROBE_FAILED'));
    });
  });
}

export async function prepareRuntimeTempStorage(
  preferredDirectory: string,
  dataDirectory: string,
  options: RuntimeTempStorageOptions = {},
): Promise<RuntimeTempStorageSelection> {
  const preferred = resolve(preferredDirectory);
  const fallback = resolve(join(dataDirectory, 'runtime-tmp'));
  const writableProbe = options.writableProbe ?? probeWritableTempDirectory;
  const sqliteProbe = options.sqliteProbe ?? probeSqliteTempDirectoryIsolated;
  const previousSqliteTmpDir = process.env['SQLITE_TMPDIR'];
  const previousTmpDir = process.env['TMPDIR'];
  const candidates: readonly RuntimeTempStorageSelection[] = [
    { mode: 'primary', directory: preferred },
    ...(fallback === preferred ? [] : [{ mode: 'data-fallback' as const, directory: fallback }]),
  ];

  for (const candidate of candidates) {
    try {
      mkdirSync(candidate.directory, { recursive: true, mode: 0o700 });
      if (candidate.mode === 'data-fallback') chmodSync(candidate.directory, 0o700);
      writableProbe(candidate.directory);
      await sqliteProbe(candidate.directory);
      process.env['SQLITE_TMPDIR'] = candidate.directory;
      process.env['TMPDIR'] = candidate.directory;
      return candidate;
    } catch {
      // Try the next bounded candidate without exposing filesystem details.
    }
  }

  restoreEnvironment('SQLITE_TMPDIR', previousSqliteTmpDir);
  restoreEnvironment('TMPDIR', previousTmpDir);
  throw new Error('RUNTIME_TEMP_STORAGE_UNAVAILABLE');
}
