import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { rmSync } from 'node:fs';
import { ApplicationLogger } from '../../src/operations/logger.ts';
import { ApplicationLogStore } from '../../src/operations/log-store.ts';

function temporaryDirectory(): string {
  return `.test-tmp/logger-${randomUUID()}`;
}

function output(tty = false): { isTTY: boolean; lines: string[]; write(value: string): boolean } {
  const lines: string[] = [];
  return { isTTY: tty, lines, write(value) { lines.push(value); return true; } };
}

test('application logger emits WebAPI-style contextual output and persists only safe structured fields', () => {
  const directory = temporaryDirectory();
  try {
    const store = new ApplicationLogStore(directory, { clock: () => new Date('2026-09-13T17:30:00.000Z') });
    const stdout = output(true);
    const stderr = output(true);
    const logger = new ApplicationLogger(store, { clock: () => new Date('2026-09-13T17:30:00.000Z'), output: stdout, errorOutput: stderr });
    logger.child('HTTP').success('http.request_completed', {
      requestId: '12345678-abcd-1234-abcd-1234567890ab', method: 'GET', path: '/api/v1/health', status: 200, durationMs: 4,
    });
    logger.child('Gateway').error('operations.request_failed', { code: 'VALIDATION_ERROR' });
    assert.match(stdout.lines.join(''), /SUCCESS/u);
    assert.match(stdout.lines.join(''), /\[HTTP\]/u);
    assert.match(stdout.lines.join(''), /\u001b\[32m/u);
    assert.match(stderr.lines.join(''), /ERROR/u);
    assert.deepEqual(store.tail(10).map(event => ({ event: event.event, context: event.context, path: event.path })), [
      { event: 'http.request_completed', context: 'HTTP', path: '/api/v1/health' },
      { event: 'operations.request_failed', context: 'Gateway', path: undefined },
    ]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('application logger suppresses repeated entries then reports the count', () => {
  const directory = temporaryDirectory();
  let now = 0;
  try {
    const store = new ApplicationLogStore(directory, { clock: () => new Date(now) });
    const stdout = output();
    const logger = new ApplicationLogger(store, { clock: () => new Date(now), output: stdout, duplicateWindowMs: 100 });
    logger.info('server.heartbeat');
    now = 50;
    logger.info('server.heartbeat');
    now = 200;
    logger.info('server.heartbeat');
    assert.deepEqual(store.tail(10).map(event => event.suppressedDuplicates), [undefined, 1]);
    assert.match(stdout.lines.at(-1) ?? '', /\+1 duplicados/u);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
