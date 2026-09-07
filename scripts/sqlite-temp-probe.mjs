import { existsSync } from 'node:fs';

const compiledModule = new URL('../dist/infrastructure/runtime-temp.js', import.meta.url);
const sourceModule = new URL('../src/infrastructure/runtime-temp.ts', import.meta.url);
const runtimeTemp = await import(existsSync(compiledModule) ? compiledModule.href : sourceModule.href);

if (process.argv.includes('--fallback')) {
  const selection = await runtimeTemp.prepareRuntimeTempStorage('/tmp/basketra', '/data');
  if (selection.mode !== 'data-fallback') {
    throw new Error('Expected automatic data fallback for the broken primary temp directory');
  }
} else {
  const sqliteTmpDir = process.env.SQLITE_TMPDIR?.trim();
  const tmpDir = process.env.TMPDIR?.trim();
  if (!sqliteTmpDir || sqliteTmpDir !== tmpDir) {
    throw new Error('SQLITE_TMPDIR and TMPDIR must identify the same configured temporary directory');
  }
  await runtimeTemp.probeSqliteTempDirectory(sqliteTmpDir);
}

if (!process.argv.includes('--isolated')) {
  console.log('SQLite temp-file probe passed.');
}
