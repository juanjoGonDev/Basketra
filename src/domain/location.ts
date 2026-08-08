export type GeoPointMicrodegrees = Readonly<{
  latitudeMicrodegrees: number;
  longitudeMicrodegrees: number;
}>;

export type LocatedStore<T> = T & GeoPointMicrodegrees;

const EARTH_RADIUS_METERS = 6_371_008.8;
const MICRODEGREES_PER_DEGREE = 1_000_000;

export function assertGeoPoint(point: GeoPointMicrodegrees): GeoPointMicrodegrees {
  if (!Number.isSafeInteger(point.latitudeMicrodegrees) || point.latitudeMicrodegrees < -90_000_000 || point.latitudeMicrodegrees > 90_000_000) {
    throw new RangeError('Latitude must be integer microdegrees between -90 and 90 degrees');
  }
  if (!Number.isSafeInteger(point.longitudeMicrodegrees) || point.longitudeMicrodegrees < -180_000_000 || point.longitudeMicrodegrees > 180_000_000) {
    throw new RangeError('Longitude must be integer microdegrees between -180 and 180 degrees');
  }
  return point;
}

export function degreesToMicrodegrees(value: number, axis: 'latitude' | 'longitude'): number {
  if (!Number.isFinite(value)) throw new RangeError(`${axis} must be finite`);
  const microdegrees = Math.round(value * MICRODEGREES_PER_DEGREE);
  assertGeoPoint(axis === 'latitude'
    ? { latitudeMicrodegrees: microdegrees, longitudeMicrodegrees: 0 }
    : { latitudeMicrodegrees: 0, longitudeMicrodegrees: microdegrees });
  return microdegrees;
}

export function distanceMeters(left: GeoPointMicrodegrees, right: GeoPointMicrodegrees): number {
  assertGeoPoint(left);
  assertGeoPoint(right);
  const latitudeOne = toRadians(left.latitudeMicrodegrees / MICRODEGREES_PER_DEGREE);
  const latitudeTwo = toRadians(right.latitudeMicrodegrees / MICRODEGREES_PER_DEGREE);
  const latitudeDelta = latitudeTwo - latitudeOne;
  const longitudeDelta = toRadians((right.longitudeMicrodegrees - left.longitudeMicrodegrees) / MICRODEGREES_PER_DEGREE);
  const sineLatitude = Math.sin(latitudeDelta / 2);
  const sineLongitude = Math.sin(longitudeDelta / 2);
  const haversine = sineLatitude * sineLatitude
    + Math.cos(latitudeOne) * Math.cos(latitudeTwo) * sineLongitude * sineLongitude;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(haversine)));
}

export function rankNearbyStores<T extends Readonly<{ id: string }>>(
  origin: GeoPointMicrodegrees,
  stores: readonly LocatedStore<T>[],
  maximumDistanceMeters: number,
): Array<LocatedStore<T> & Readonly<{ distanceMeters: number }>> {
  assertGeoPoint(origin);
  if (!Number.isFinite(maximumDistanceMeters) || maximumDistanceMeters <= 0) {
    throw new RangeError('Maximum distance must be positive');
  }
  return stores
    .map((store) => ({ ...store, distanceMeters: distanceMeters(origin, store) }))
    .filter((store) => store.distanceMeters <= maximumDistanceMeters)
    .sort((left, right) => left.distanceMeters - right.distanceMeters || left.id.localeCompare(right.id));
}

function toRadians(degrees: number): number {
  return degrees * Math.PI / 180;
}
