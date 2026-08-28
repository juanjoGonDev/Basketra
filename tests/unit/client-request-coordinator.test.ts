import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_REQUEST_THROTTLE_MS,
  createRequestCoordinator,
  requestBucketKey,
} from '../../src/web/api.js';

type FetchCall = Readonly<{
  url: string;
  method: string;
  startedAt: number;
  body?: string;
}>;

function controlledScheduler() {
  let now = 0;
  const waits: number[] = [];
  return {
    now: () => now,
    wait: async (milliseconds: number) => {
      waits.push(milliseconds);
      now += milliseconds;
    },
    waits,
  };
}

function createFetchRecorder(now: () => number, calls: FetchCall[], options: Readonly<{ failFirst?: boolean }> = {}): typeof fetch {
  let callCount = 0;
  return (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    callCount += 1;
    const method = String(init.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
    const url = input instanceof Request ? input.url : String(input);
    const body = typeof init.body === 'string' ? init.body : undefined;
    calls.push({ url, method, startedAt: now(), ...(body === undefined ? {} : { body }) });
    if (options.failFirst && callCount === 1) throw new TypeError('network down');
    return new Response(JSON.stringify({ url, method, body }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
}

test('request buckets are method + pathname and ignore query parameters and fragments', () => {
  assert.equal(
    requestBucketKey('/api/v1/settings/ai-provider?refresh=1#health', { method: 'GET' }, 'https://basketra.test'),
    'GET /api/v1/settings/ai-provider',
  );
  assert.equal(
    requestBucketKey('/api/v1/settings/ai-provider?refresh=2', { method: 'POST' }, 'https://basketra.test'),
    'POST /api/v1/settings/ai-provider',
  );
});

test('query variants share one throttle bucket while different paths remain independent', async () => {
  const scheduler = controlledScheduler();
  const calls: FetchCall[] = [];
  const coordinator = createRequestCoordinator({
    baseUrl: 'https://basketra.test',
    fetchImpl: createFetchRecorder(scheduler.now, calls),
    now: scheduler.now,
    wait: scheduler.wait,
  });

  await Promise.all([
    coordinator.request('/api/v1/settings/ai-provider?refresh=1'),
    coordinator.request('/api/v1/settings/ai-provider?refresh=2'),
  ]);
  await coordinator.request('/api/v1/diagnostics?refresh=3');

  assert.deepEqual(calls.map(call => [call.url, call.startedAt]), [
    ['/api/v1/settings/ai-provider?refresh=1', 0],
    ['/api/v1/settings/ai-provider?refresh=2', DEFAULT_REQUEST_THROTTLE_MS],
    ['/api/v1/diagnostics?refresh=3', DEFAULT_REQUEST_THROTTLE_MS],
  ]);
  assert.deepEqual(scheduler.waits, [DEFAULT_REQUEST_THROTTLE_MS]);
});

test('identical safe reads share one in-flight transport and receive independent responses', async () => {
  const scheduler = controlledScheduler();
  const calls: FetchCall[] = [];
  let release: (() => void) | undefined;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const fetchImpl = (async (input: RequestInfo | URL) => {
    calls.push({ url: String(input), method: 'GET', startedAt: scheduler.now() });
    await gate;
    return new Response('shared', { status: 200 });
  }) as typeof fetch;
  const coordinator = createRequestCoordinator({
    baseUrl: 'https://basketra.test',
    fetchImpl,
    now: scheduler.now,
    wait: scheduler.wait,
  });

  const first = coordinator.request('/api/v1/settings/ai-provider');
  const second = coordinator.request('/api/v1/settings/ai-provider');
  await Promise.resolve();
  assert.equal(calls.length, 1);
  release?.();

  const [firstResponse, secondResponse] = await Promise.all([first, second]);
  assert.equal(await firstResponse.text(), 'shared');
  assert.equal(await secondResponse.text(), 'shared');
  assert.equal(calls.length, 1);
});

test('mutations are serialized by endpoint and are never dropped', async () => {
  const scheduler = controlledScheduler();
  const calls: FetchCall[] = [];
  const coordinator = createRequestCoordinator({
    baseUrl: 'https://basketra.test',
    fetchImpl: createFetchRecorder(scheduler.now, calls),
    now: scheduler.now,
    wait: scheduler.wait,
  });

  const responses = await Promise.all([
    coordinator.request('/api/v1/logs/client?batch=1', { method: 'POST', body: 'first' }),
    coordinator.request('/api/v1/logs/client?batch=2', { method: 'POST', body: 'second' }),
    coordinator.request('/api/v1/logs/client?batch=3', { method: 'POST', body: 'third' }),
  ]);

  assert.deepEqual(calls.map(call => [call.body, call.startedAt]), [
    ['first', 0],
    ['second', DEFAULT_REQUEST_THROTTLE_MS],
    ['third', DEFAULT_REQUEST_THROTTLE_MS * 2],
  ]);
  assert.equal(responses.length, 3);
});

test('a failed or aborted request releases its bucket without replaying transport', async () => {
  const scheduler = controlledScheduler();
  const calls: FetchCall[] = [];
  const coordinator = createRequestCoordinator({
    baseUrl: 'https://basketra.test',
    fetchImpl: createFetchRecorder(scheduler.now, calls, { failFirst: true }),
    now: scheduler.now,
    wait: scheduler.wait,
  });

  await assert.rejects(
    coordinator.request('/api/v1/settings/ai-provider'),
    /network down/,
  );
  const recovered = await coordinator.request('/api/v1/settings/ai-provider?retry=1');
  assert.equal(recovered.status, 200);

  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    coordinator.request('/api/v1/settings/ai-provider?aborted=1', { signal: controller.signal }),
    error => error instanceof DOMException && error.name === 'AbortError',
  );

  assert.equal(calls.length, 2);
  assert.deepEqual(calls.map(call => call.startedAt), [0, DEFAULT_REQUEST_THROTTLE_MS]);
});
