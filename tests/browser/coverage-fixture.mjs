import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test as base, expect } from '@playwright/test';

const COVERAGE_PATHS = new Set(['/operations.js', '/receipts.js']);
const COVERAGE_DIRECTORY = resolve('.coverage/browser');

function relevantCoverage(entries) {
  return entries.filter(entry => {
    try {
      return COVERAGE_PATHS.has(new URL(entry.url).pathname);
    } catch {
      return false;
    }
  });
}

export const test = base.extend({
  page: async ({ page }, use, testInfo) => {
    await page.coverage.startJSCoverage({
      resetOnNavigation: false,
      reportAnonymousScripts: false,
    });
    try {
      await use(page);
    } finally {
      const entries = relevantCoverage(await page.coverage.stopJSCoverage());
      mkdirSync(COVERAGE_DIRECTORY, { recursive: true });
      const fileName = [
        String(testInfo.workerIndex),
        String(testInfo.retry),
        testInfo.testId.replace(/[^a-zA-Z0-9_-]+/gu, '-').slice(0, 80),
        randomUUID(),
      ].join('-');
      writeFileSync(
        resolve(COVERAGE_DIRECTORY, `${fileName}.json`),
        `${JSON.stringify(entries)}\n`,
        { flag: 'wx' },
      );
    }
  },
});

export { expect };
