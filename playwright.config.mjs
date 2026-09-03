import './tests/browser/register-coverage-loader.mjs';
import { defineConfig, devices } from '@playwright/test';

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
    command: 'node tests/browser/start-server.mjs',
    url: 'http://127.0.0.1:3000/readiness',
    timeout: 30_000,
    reuseExistingServer: process.env.PLAYWRIGHT_REUSE_SERVER === '1',
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
