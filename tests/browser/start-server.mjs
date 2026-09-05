import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, rmSync } from 'node:fs';
import { delimiter, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const repositoryDirectory = process.cwd();
const runtimeDirectory = process.env.CI
  ? `/dev/shm/basketra-playwright-${process.env.GITHUB_RUN_ID ?? process.pid}`
  : resolve(repositoryDirectory, '.playwright-runtime');

rmSync(runtimeDirectory, { recursive: true, force: true });
mkdirSync(runtimeDirectory, { recursive: true });
if (process.platform !== 'win32') chmodSync(resolve(repositoryDirectory, 'tests/fixtures/tesseract'), 0o755);

const build = spawnSync(process.execPath, ['scripts/build.mjs'], {
  cwd: repositoryDirectory,
  stdio: 'inherit',
  shell: false,
});
if (build.status !== 0) process.exit(build.status ?? 1);

process.chdir(runtimeDirectory);
process.env.PATH = `${resolve(repositoryDirectory, 'tests/fixtures')}${delimiter}${process.env.PATH || ''}`;
process.env.BASKETRA_VERSION = '1.4.2-test';
process.env.BASKETRA_REVISION = 'abcdef1234567';
await import(pathToFileURL(resolve(repositoryDirectory, 'dist/main.js')).href);
