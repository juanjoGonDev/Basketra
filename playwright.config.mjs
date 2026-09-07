import './tests/browser/register-coverage-loader.mjs';
import { defineConfig, devices } from '@playwright/test';

const inCi = process.env.CI === 'true';

export default defineConfig({
  testDir: './tests/browser',
  fullyParallel: true,
  workers: 1,
  retries: 0,
  timeout: 30_000,
  expect: { timeout: 5_000 },
  reporter: [
    ['list'],
    ...(!inCi ? [['html', { outputFolder: 'playwright-report', open: 'never' }]] : []),
    ['./tests/browser/coverage-reporter.mjs'],
  ],
  use: {
    baseURL: 'http://127.0.0.1:3000',
    trace: inCi ? 'retain-on-failure' : 'on',
    screenshot: inCi ? 'only-on-failure' : 'on',
    video: inCi ? 'retain-on-failure' : 'on',
    ...devices['Pixel 7'],
  },
  webServer: {
    command: 'node tests/browser/start-server.mjs',
    url: 'http://127.0.0.1:3000/readiness',
    timeout: 30_000,
    reuseExistingServer: process.env.PLAYWRIGHT_REUSE_SERVER === '1',
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
