import {
  prepareRuntimeTempStorage,
  probeSqliteTempDirectory,
} from '../dist/infrastructure/runtime-temp.js';

if (process.argv.includes('--fallback')) {
  const selection = await prepareRuntimeTempStorage('/tmp/basketra', '/data');
  if (selection.mode !== 'data-fallback') {
    throw new Error('Expected automatic data fallback for the broken primary temp directory');
  }
} else {
  const sqliteTmpDir = process.env.SQLITE_TMPDIR?.trim();
  const tmpDir = process.env.TMPDIR?.trim();
  if (!sqliteTmpDir || sqliteTmpDir !== tmpDir) {
    throw new Error('SQLITE_TMPDIR and TMPDIR must identify the same configured temporary directory');
  }
  await probeSqliteTempDirectory(sqliteTmpDir);
}

console.log('SQLite temp-file probe passed.');
