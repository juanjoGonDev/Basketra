import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { rmSync } from 'node:fs';
import test from 'node:test';

import type { AppConfig } from '../../src/infrastructure/config.ts';
import { OperationsGateway } from '../../src/operations/gateway.ts';

function config(dataDir: string): AppConfig {
  return {
    host: '127.0.0.1',
    port: 0,
    dataDir,
    tempDir: `${dataDir}/tmp`,
    maxBodyBytes: 8 * 1024 * 1024,
    aiTimeoutMs: 1_000,
    aiMaxRetries: 0,
    aiImageCapability: true,
    aiPdfCapability: false,
    overpassBaseUrl: 'http://127.0.0.1:9/api/',
    idleHibernateAfterMs: 0,
    idleExitAfterMs: 0,
  };
}

test('operations gateway serves the receipt AI recovery module with script security headers', async () => {
  const directory = `.test-tmp/receipt-ai-recovery-asset-${randomUUID()}`;
  const gateway = new OperationsGateway(config(directory));

  try {
    await gateway.listen();
    const baseUrl = `http://127.0.0.1:${gateway.address().port}`;
    const response = await fetch(`${baseUrl}/receipt-ai-recovery.js`);

    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'text/javascript; charset=utf-8');
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.match(await response.text(), /export function buildReceiptAiRecovery/u);
  } finally {
    await gateway.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
