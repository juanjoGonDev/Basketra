import './tests/browser/register-coverage-loader.mjs';
import { defineConfig, devices } from '@playwright/test';

const repositoryDirectory = process.cwd();
const runtimeDirectory = process.env.CI
  ? `/dev/shm/basketra-playwright-${process.env.GITHUB_RUN_ID ?? process.pid}`
  : '.playwright-runtime';
const quote = value => `'${value.replaceAll("'", "'\\''")}'`;

export default defineConfig({
  testDir: './tests/browser',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 30_000,
  expect: { timeout: 5_000 },
  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
    ['./tests/browser/coverage-reporter.mjs'],
  ],
  use: {
    baseURL: 'http://127.0.0.1:3000',
    trace: 'on',
    screenshot: 'on',
    video: 'on',
    ...devices['Pixel 7'],
  },
  webServer: {
    command: [
      `rm -rf ${quote(runtimeDirectory)}`,
      `mkdir -p ${quote(runtimeDirectory)}`,
      'chmod +x tests/fixtures/tesseract',
      'node scripts/build.mjs',
      `cd ${quote(runtimeDirectory)}`,
      `PATH=${quote(`${repositoryDirectory}/tests/fixtures`)}:$PATH BASKETRA_VERSION=1.4.2-test BASKETRA_REVISION=abcdef1234567 node ${quote(`${repositoryDirectory}/dist/main.js`)}`,
    ].join(' && '),
    url: 'http://127.0.0.1:3000/readiness',
    timeout: 30_000,
    reuseExistingServer: false,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
