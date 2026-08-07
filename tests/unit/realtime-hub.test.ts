import test from 'node:test';
import assert from 'node:assert/strict';
import { RealtimeHub } from '../../src/realtime/hub.ts';

test('realtime hub broadcasts minimal invalidations and removes listeners deterministically', () => {
  const hub = new RealtimeHub(2);
  const first: unknown[] = [];
  const second: unknown[] = [];
  const unsubscribeFirst = hub.subscribe((event) => first.push(event));
  const unsubscribeSecond = hub.subscribe((event) => second.push(event));
  assert.equal(hub.clientCount, 2);
  assert.throws(() => hub.subscribe(() => {}), /REALTIME_CLIENT_LIMIT_REACHED/);

  const event = {
    entityType: 'shopping-list-item' as const,
    mutation: 'updated' as const,
    listId: 'list_1',
    entityId: 'item_1',
    version: 2,
    updatedAt: '2026-08-07T10:00:00.000Z',
  };
  hub.publish(event);
  assert.deepEqual(first, [event]);
  assert.deepEqual(second, [event]);

  unsubscribeFirst();
  unsubscribeFirst();
  assert.equal(hub.clientCount, 1);
  hub.publish({ ...event, version: 3 });
  assert.equal(first.length, 1);
  assert.equal(second.length, 2);
  unsubscribeSecond();
  assert.equal(hub.clientCount, 0);
});

test('realtime hub validates client bounds', () => {
  assert.throws(() => new RealtimeHub(0), /between 1 and 64/);
  assert.throws(() => new RealtimeHub(65), /between 1 and 64/);
});
