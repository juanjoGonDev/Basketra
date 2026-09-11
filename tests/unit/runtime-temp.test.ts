import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { rmSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import test from 'node:test';
import {
  prepareRuntimeTempStorage,
  probeSqliteTempDirectory,
  probeSqliteTempDirectoryIsolated,
} from '../../src/infrastructure/runtime-temp.ts';

function temporaryDirectory(label: string): string {
  return `.test-tmp/${label}-${randomUUID()}`;
}

function restoreTempEnvironment(sqliteTmpDir: string | undefined, tmpDir: string | undefined): void {
  if (sqliteTmpDir === undefined) delete process.env['SQLITE_TMPDIR'];
  else process.env['SQLITE_TMPDIR'] = sqliteTmpDir;
  if (tmpDir === undefined) delete process.env['TMPDIR'];
  else process.env['TMPDIR'] = tmpDir;
}

test('runtime temp preparation keeps a verified preferred directory', async () => {
  const root = temporaryDirectory('runtime-temp-primary');
  const preferred = join(root, 'preferred');
  const previousSqliteTmpDir = process.env['SQLITE_TMPDIR'];
  const previousTmpDir = process.env['TMPDIR'];
  try {
    const selection = await prepareRuntimeTempStorage(preferred, root);
    assert.deepEqual(selection, {
      mode: 'primary',
      directory: resolve(preferred),
    });
    assert.equal(process.env['SQLITE_TMPDIR'], resolve(preferred));
    assert.equal(process.env['TMPDIR'], resolve(preferred));
    await probeSqliteTempDirectory(selection.directory);
  } finally {
    restoreTempEnvironment(previousSqliteTmpDir, previousTmpDir);
    rmSync(root, { recursive: true, force: true });
  }
});

test('runtime temp preparation falls back to private data storage when preferred storage fails', async () => {
  const root = temporaryDirectory('runtime-temp-fallback');
  const preferred = resolve(join(root, 'preferred'));
  const fallback = resolve(join(root, 'runtime-tmp'));
  const previousSqliteTmpDir = process.env['SQLITE_TMPDIR'];
  const previousTmpDir = process.env['TMPDIR'];
  try {
    const selection = await prepareRuntimeTempStorage(preferred, root, {
      writableProbe: (directory) => {
        if (directory === preferred) throw new Error('SIMULATED_PRIMARY_FAILURE');
      },
    });
    assert.deepEqual(selection, {
      mode: 'data-fallback',
      directory: fallback,
    });
    assert.equal(process.env['SQLITE_TMPDIR'], fallback);
    assert.equal(process.env['TMPDIR'], fallback);
    // Windows reports ACL-backed directories with its synthetic mode bits, so
    // POSIX permissions cannot be asserted from stat there.
    if (process.platform !== 'win32') {
      assert.equal(statSync(fallback).mode & 0o777, 0o700);
    }
  } finally {
    restoreTempEnvironment(previousSqliteTmpDir, previousTmpDir);
    rmSync(root, { recursive: true, force: true });
  }
});

test('runtime temp preparation retries the fallback when the strong SQLite probe rejects the writable primary', async () => {
  const root = temporaryDirectory('runtime-temp-sqlite-fallback');
  const preferred = resolve(join(root, 'preferred'));
  const fallback = resolve(join(root, 'runtime-tmp'));
  const previousSqliteTmpDir = process.env['SQLITE_TMPDIR'];
  const previousTmpDir = process.env['TMPDIR'];
  try {
    const selection = await prepareRuntimeTempStorage(preferred, root, {
      sqliteProbe: async (directory) => {
        if (directory === preferred) throw new Error('SIMULATED_SQLITE_PRIMARY_FAILURE');
        await probeSqliteTempDirectory(directory);
      },
    });
    assert.deepEqual(selection, {
      mode: 'data-fallback',
      directory: fallback,
    });
  } finally {
    restoreTempEnvironment(previousSqliteTmpDir, previousTmpDir);
    rmSync(root, { recursive: true, force: true });
  }
});

test('isolated SQLite probe validates a candidate without loading SQLite into the parent bootstrap', async () => {
  const root = temporaryDirectory('runtime-temp-isolated');
  const directory = resolve(join(root, 'candidate'));
  try {
    const selection = await prepareRuntimeTempStorage(directory, root, {
      sqliteProbe: probeSqliteTempDirectoryIsolated,
    });
    assert.equal(selection.mode, 'primary');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('runtime temp preparation fails closed and preserves the previous environment when no candidate works', async () => {
  const root = temporaryDirectory('runtime-temp-fail');
  const previousSqliteTmpDir = process.env['SQLITE_TMPDIR'];
  const previousTmpDir = process.env['TMPDIR'];
  process.env['SQLITE_TMPDIR'] = 'previous-sqlite-temp';
  process.env['TMPDIR'] = 'previous-temp';
  try {
    await assert.rejects(
      prepareRuntimeTempStorage(join(root, 'preferred'), root, {
        writableProbe: () => {
          throw new Error('SIMULATED_FAILURE');
        },
      }),
      /RUNTIME_TEMP_STORAGE_UNAVAILABLE/u,
    );
    assert.equal(process.env['SQLITE_TMPDIR'], 'previous-sqlite-temp');
    assert.equal(process.env['TMPDIR'], 'previous-temp');
  } finally {
    restoreTempEnvironment(previousSqliteTmpDir, previousTmpDir);
    rmSync(root, { recursive: true, force: true });
  }
});
