import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  AiRuntimeCapabilitiesCacheStore,
  installAiRuntimeCapabilitiesCache,
} from '../../src/ai/runtime-capabilities-cache.ts';
import { BasketraDatabase } from '../../src/infrastructure/database.ts';

const baseUrl = new URL('http://webapi.test/v1/');
const model = 'default';
const capabilities = {
  attachments: {
    maxCount: 10,
    maxFileBytes: 512 * 1024 * 1024,
    maxImageBytes: 20 * 1024 * 1024,
    maxSpreadsheetBytes: 50 * 1024 * 1024,
    maxUploadsPerThreeHours: 80,
  },
  execution: { replyInactivityTimeoutMs: 120_000 },
  requests: { maxJsonBodyBytes: 500 * 1024 * 1024 },
} as const;

function createDatabasePath(): Readonly<{ directory: string; path: string }> {
  const directory = mkdtempSync(join(tmpdir(), 'basketra-capabilities-'));
  const path = join(directory, 'basketra.db');
  const database = new BasketraDatabase(path, { migrationBackupDir: join(directory, 'migration-backups') });
  database.close();
  return { directory, path };
}

test('last validated WebAPI capabilities survive SQLite reopen without persisting credentials', () => {
  const fixture = createDatabasePath();
  try {
    const first = new AiRuntimeCapabilitiesCacheStore(fixture.path);
    first.write(baseUrl, model, capabilities);
    assert.deepEqual(first.read(baseUrl, model), capabilities);
    first.close();

    const reopened = new AiRuntimeCapabilitiesCacheStore(fixture.path);
    assert.deepEqual(reopened.read(baseUrl, model), capabilities);
    assert.equal(reopened.read(baseUrl, 'other-model'), undefined);
    reopened.close();
  } finally {
    rmSync(fixture.directory, { recursive: true, force: true });
  }
});

test('installed capability fetch prefers live WebAPI and falls back to the persisted last valid snapshot', async () => {
  const fixture = createDatabasePath();
  const originalFetch = globalThis.fetch;
  let live = true;
  let reads = 0;
  globalThis.fetch = (async (resource) => {
    const url = new URL(resource instanceof Request ? resource.url : String(resource));
    if (!url.pathname.endsWith('/capabilities')) throw new Error('unexpected request');
    reads += 1;
    if (!live) throw new Error('webapi unavailable');
    return new Response(JSON.stringify(capabilities), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;

  let uninstall: (() => void) | undefined;
  try {
    uninstall = installAiRuntimeCapabilitiesCache({
      databasePath: fixture.path,
      baseUrl,
      model,
    });
    const first = await fetch(new URL('capabilities', baseUrl));
    assert.equal(first.status, 200);
    assert.deepEqual(await first.json(), capabilities);

    live = false;
    const fallback = await fetch(new URL('capabilities', baseUrl));
    assert.equal(fallback.status, 200);
    assert.equal(fallback.headers.get('x-basketra-capabilities-cache'), 'stale');
    assert.deepEqual(await fallback.json(), capabilities);
    assert.equal(reads, 2);
  } finally {
    uninstall?.();
    globalThis.fetch = originalFetch;
    rmSync(fixture.directory, { recursive: true, force: true });
  }
});

test('invalid live capability documents are never persisted as fallback policy', async () => {
  const fixture = createDatabasePath();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify({ attachments: {} }), { status: 200 })) as typeof fetch;
  let uninstall: (() => void) | undefined;
  try {
    uninstall = installAiRuntimeCapabilitiesCache({ databasePath: fixture.path, baseUrl, model });
    const response = await fetch(new URL('capabilities', baseUrl));
    assert.equal(response.status, 200);
    const store = new AiRuntimeCapabilitiesCacheStore(fixture.path);
    assert.equal(store.read(baseUrl, model), undefined);
    store.close();
  } finally {
    uninstall?.();
    globalThis.fetch = originalFetch;
    rmSync(fixture.directory, { recursive: true, force: true });
  }
});
