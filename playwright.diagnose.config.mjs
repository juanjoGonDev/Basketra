import { defineConfig, devices } from '@playwright/test';

// TEMPORARY CI diagnostic configuration. It runs only tests/browser/diagnose-probe.probe.mjs, which
// the main configuration never matches, so shard planning and the quality gate are unaffected.
// Delete this file together with the probe once the diagnosis is complete.
export default defineConfig({
  testDir: './tests/browser',
  testMatch: 'diagnose-probe.probe.mjs',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 5_000 },
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:3000',
    trace: 'off',
    screenshot: 'off',
    video: 'off',
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
