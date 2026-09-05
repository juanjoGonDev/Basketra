import test from 'node:test';
import assert from 'node:assert/strict';
import { localDateBoundaryIso, parsePercentageBasisPoints } from '../../src/web/ticket-history-values.js';

test('ticket-history date filters preserve the browser local calendar day before converting to UTC', () => {
  const previousTimezone = process.env.TZ;
  process.env.TZ = 'Europe/Madrid';
  try {
    assert.equal(localDateBoundaryIso('2026-09-02'), '2026-09-01T22:00:00.000Z');
    assert.equal(localDateBoundaryIso('2026-09-02', { endOfDay: true }), '2026-09-02T21:59:59.999Z');
    assert.throws(() => localDateBoundaryIso('2026-02-30'), /no existe/u);
  } finally {
    if (previousTimezone === undefined) delete process.env.TZ;
    else process.env.TZ = previousTimezone;
  }
});

test('ticket-history percentage parsing converts decimal text to exact integer basis points', () => {
  assert.equal(parsePercentageBasisPoints('0'), 0);
  assert.equal(parsePercentageBasisPoints('0,01'), 1);
  assert.equal(parsePercentageBasisPoints('12.34'), 1234);
  assert.equal(parsePercentageBasisPoints('100'), 10_000);
  assert.throws(() => parsePercentageBasisPoints('12.345'), /dos decimales/u);
  assert.throws(() => parsePercentageBasisPoints('100.01'), /entre 0 y 100/u);
});
