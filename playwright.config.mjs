import { defineConfig, devices } from '@playwright/test';

const temporaryDirectory = process.env.CI
  ? `/dev/shm/basketra-playwright-${process.env.GITHUB_RUN_ID ?? process.pid}`
  : '.playwright-tmp';

export default defineConfig({
  testDir: './tests/browser',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 30_000,
  expect: { timeout: 5_000 },
  reporter: [['list'], ['html', { outputFolder: 'playwright-report', open: 'never' }]],
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'on',
    screenshot: 'on',
    video: 'on',
    ...devices['Pixel 7'],
  },
  webServer: {
    command: `node scripts/build.mjs && BASKETRA_HOST=127.0.0.1 BASKETRA_PORT=4173 BASKETRA_DATA_DIR=.playwright-data BASKETRA_TEMP_DIR=${temporaryDirectory} node dist/main.js`,
    url: 'http://127.0.0.1:4173/readiness',
    timeout: 30_000,
    reuseExistingServer: false,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
