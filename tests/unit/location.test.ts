import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertGeoPoint,
  degreesToMicrodegrees,
  distanceMeters,
  rankNearbyStores,
} from '../../src/domain/location.ts';

test('location converts browser degrees to validated integer microdegrees', () => {
  assert.equal(degreesToMicrodegrees(40.416775, 'latitude'), 40_416_775);
  assert.equal(degreesToMicrodegrees(-3.70379, 'longitude'), -3_703_790);
  assert.throws(() => degreesToMicrodegrees(Number.NaN, 'latitude'), /finite/);
  assert.throws(() => degreesToMicrodegrees(91, 'latitude'), /Latitude/);
  assert.throws(() => degreesToMicrodegrees(181, 'longitude'), /Longitude/);
  assert.throws(() => assertGeoPoint({ latitudeMicrodegrees: 1.5, longitudeMicrodegrees: 0 }), /Latitude/);
  assert.throws(() => assertGeoPoint({ latitudeMicrodegrees: 0, longitudeMicrodegrees: 1.5 }), /Longitude/);
});

test('location ranks only persisted stores within the requested distance', () => {
  const origin = { latitudeMicrodegrees: 40_416_775, longitudeMicrodegrees: -3_703_790 };
  const nearby = { id: 'near', latitudeMicrodegrees: 40_417_000, longitudeMicrodegrees: -3_704_000 };
  const farther = { id: 'far', latitudeMicrodegrees: 40_420_000, longitudeMicrodegrees: -3_710_000 };
  const distance = distanceMeters(origin, nearby);
  assert.ok(distance > 0 && distance < 100);

  const ranked = rankNearbyStores(origin, [farther, nearby], 1_000);
  assert.deepEqual(ranked.map((store) => store.id), ['near', 'far']);
  assert.ok(ranked[0]!.distanceMeters < ranked[1]!.distanceMeters);
  assert.deepEqual(rankNearbyStores(origin, [farther], 100), []);
  assert.throws(() => rankNearbyStores(origin, [nearby], 0), /Maximum distance/);
  assert.throws(() => rankNearbyStores(origin, [nearby], Number.NaN), /Maximum distance/);
});

test('location ranking breaks equal-distance ties by stable store id', () => {
  const origin = { latitudeMicrodegrees: 40_416_775, longitudeMicrodegrees: -3_703_790 };
  const sameLocationB = { id: 'store-b', ...origin };
  const sameLocationA = { id: 'store-a', ...origin };

  const ranked = rankNearbyStores(origin, [sameLocationB, sameLocationA], 10);

  assert.deepEqual(ranked.map((store) => store.id), ['store-a', 'store-b']);
  assert.deepEqual(ranked.map((store) => store.distanceMeters), [0, 0]);
});
