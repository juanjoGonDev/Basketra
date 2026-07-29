const FULL_SHA_TAG = /^[a-f0-9]{40}$/;

function releaseTags(version) {
  const tags = version?.metadata?.container?.tags;
  return Array.isArray(tags) ? tags.filter((tag) => typeof tag === 'string') : [];
}

export function selectGhcrVersionsForDeletion(versions, currentSha, retainCount) {
  if (!FULL_SHA_TAG.test(currentSha)) throw new RangeError('currentSha must be a lowercase full commit SHA');
  if (!Number.isSafeInteger(retainCount) || retainCount < 1) throw new RangeError('retainCount must be a positive safe integer');
  if (!Array.isArray(versions)) throw new TypeError('versions must be an array');

  const releases = versions
    .map((version) => {
      if (!Number.isSafeInteger(version?.id) || version.id <= 0) throw new TypeError('GHCR package version id must be a positive safe integer');
      return { version, tags: releaseTags(version) };
    })
    .filter(({ tags }) => tags.some((tag) => FULL_SHA_TAG.test(tag)))
    .sort((left, right) => {
      const leftTime = Date.parse(left.version.created_at ?? '');
      const rightTime = Date.parse(right.version.created_at ?? '');
      const normalizedLeft = Number.isFinite(leftTime) ? leftTime : 0;
      const normalizedRight = Number.isFinite(rightTime) ? rightTime : 0;
      return normalizedRight - normalizedLeft || Number(right.version.id) - Number(left.version.id);
    });

  const retained = new Set(
    releases
      .filter(({ tags }) => tags.includes(currentSha) || tags.includes('stable'))
      .map(({ version }) => version.id),
  );
  for (const { version } of releases) {
    if (retained.size >= retainCount) break;
    retained.add(version.id);
  }

  return releases
    .filter(({ version }) => !retained.has(version.id))
    .map(({ version }) => version.id);
}
