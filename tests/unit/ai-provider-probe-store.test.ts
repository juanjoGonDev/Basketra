import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { BasketraDatabase } from '../../src/infrastructure/database.ts';
import { AiProviderProbeStore } from '../../src/operations/ai-provider-probe-store.ts';

test('AI provider probe history persists the latest bounded result in SQLite', () => {
  const directory = mkdtempSync(join(tmpdir(), 'basketra-ai-probe-'));
  try {
    const database = new BasketraDatabase(join(directory, 'basketra.db'));
    database.close();
    let now = new Date('2026-08-11T20:00:00.000Z');
    const store = new AiProviderProbeStore(directory, () => now);

    store.recordFailure('startup', 125, 'AI_UNREACHABLE');
    assert.deepEqual(store.latest(), {
      checkedAt: '2026-08-11T20:00:00.000Z',
      durationMs: 125,
      errorCode: 'AI_UNREACHABLE',
      status: 'error',
      trigger: 'startup',
    });

    now = new Date('2026-08-11T20:05:00.000Z');
    store.recordSuccess('manual', 240, {
      ok: true,
      model: 'gpt-5',
      imageStructuredOutput: true,
    });
    assert.deepEqual(store.latest(), {
      checkedAt: '2026-08-11T20:05:00.000Z',
      durationMs: 240,
      status: 'success',
      trigger: 'manual',
      connection: {
        ok: true,
        model: 'gpt-5',
        imageStructuredOutput: true,
      },
    });

    store.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
