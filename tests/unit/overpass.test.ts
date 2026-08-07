import test from 'node:test';
import assert from 'node:assert/strict';
import { OverpassClient } from '../../src/stores/overpass.ts';

test('overpass lookup is explicit, bounded and parses only geolocated named stores', async () => {
  let requestedUrl = '';
  let requestedBody = '';
  const fakeFetch: typeof fetch = async (input, init) => {
    requestedUrl = String(input);
    requestedBody = String(init?.body ?? '');
    return new Response(JSON.stringify({
      elements: [
        { type: 'node', id: 1, lat: 40.4168, lon: -3.7038, tags: { name: 'Mercado Uno', 'addr:street': 'Calle Mayor', 'addr:housenumber': '1', 'addr:city': 'Madrid' } },
        { type: 'way', id: 2, center: { lat: 40.417, lon: -3.704 }, tags: { name: 'Super Dos' } },
        { type: 'node', id: 3, lat: 40.42, lon: -3.71, tags: {} },
      ],
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const client = new OverpassClient(new URL('http://127.0.0.1:4321/api/'), fakeFetch);
  const candidates = await client.findNearbyStores({
    latitudeMicrodegrees: 40_416_775,
    longitudeMicrodegrees: -3_703_790,
    radiusMeters: 1_500,
    limit: 10,
  });

  assert.equal(requestedUrl, 'http://127.0.0.1:4321/api/interpreter');
  assert.match(requestedBody, /shop/);
  assert.match(requestedBody, /1500/);
  assert.deepEqual(candidates, [
    {
      osmType: 'node',
      osmId: '1',
      name: 'Mercado Uno',
      latitudeMicrodegrees: 40_416_800,
      longitudeMicrodegrees: -3_703_800,
      address: 'Calle Mayor 1, Madrid',
    },
    {
      osmType: 'way',
      osmId: '2',
      name: 'Super Dos',
      latitudeMicrodegrees: 40_417_000,
      longitudeMicrodegrees: -3_704_000,
    },
  ]);
});

test('overpass lookup rejects unsafe configuration, bad bounds and provider failures', async () => {
  assert.throws(() => new OverpassClient(new URL('ftp://example.test/api/')), /HTTP or HTTPS/);
  assert.throws(() => new OverpassClient(new URL('https://user:pass@example.test/api/')), /credential-free/);

  const unavailable = new OverpassClient(new URL('https://example.test/api/'), async () => new Response('', { status: 503 }));
  await assert.rejects(() => unavailable.findNearbyStores({
    latitudeMicrodegrees: 0,
    longitudeMicrodegrees: 0,
    radiusMeters: 1_000,
    limit: 8,
  }), /OVERPASS_UNAVAILABLE/);
  await assert.rejects(() => unavailable.findNearbyStores({
    latitudeMicrodegrees: 0,
    longitudeMicrodegrees: 0,
    radiusMeters: 99,
    limit: 8,
  }), /radius/);
  await assert.rejects(() => unavailable.findNearbyStores({
    latitudeMicrodegrees: 0,
    longitudeMicrodegrees: 0,
    radiusMeters: 1_000,
    limit: 21,
  }), /limit/);
});
