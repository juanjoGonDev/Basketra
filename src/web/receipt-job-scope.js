export function capturesByKeys(captures, keys) {
  if (!Array.isArray(keys) || keys.length === 0) return captures;
  const byKey = new Map(captures.map(capture => [capture.storageKey, capture]));
  return keys.map(key => byKey.get(key)).filter(Boolean);
}
