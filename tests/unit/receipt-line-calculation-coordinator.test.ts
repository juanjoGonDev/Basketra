import assert from 'node:assert/strict';
import test from 'node:test';

import { createRequestCoordinator } from '../../src/web/api.js';

test('receipt line calculations bypass mutation serialization and request throttling', async () => {
  let now = 0;
  const waits: number[] = [];
  const startedAt: number[] = [];
  let releaseFirst: (() => void) | undefined;
  let secondStarted: (() => void) | undefined;
  const firstGate = new Promise<void>(resolve => { releaseFirst = resolve; });
  const secondGate = new Promise<void>(resolve => { secondStarted = resolve; });
  let calls = 0;
  const fetchImpl = (async () => {
    calls += 1;
    startedAt.push(now);
    if (calls === 1) await firstGate;
    else secondStarted?.();
    return new Response('{"lineTotalMinor":100}', { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  const coordinator = createRequestCoordinator({
    baseUrl: 'https://basketra.test',
    fetchImpl,
    now: () => now,
    wait: async (milliseconds: number) => {
      waits.push(milliseconds);
      now += milliseconds;
    },
  });

  const first = coordinator.request('/api/v1/receipts/calculate-line', { method: 'POST', body: '{}' });
  const second = coordinator.request('/api/v1/receipts/calculate-line', { method: 'POST', body: '{}' });
  await secondGate;

  assert.deepEqual(startedAt, [0, 0]);
  assert.deepEqual(waits, []);
  releaseFirst?.();
  await Promise.all([first, second]);
});
