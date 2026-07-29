import test from 'node:test';
import assert from 'node:assert/strict';
import { selectGhcrVersionsForDeletion } from '../../scripts/ghcr-retention-policy.mjs';

const currentSha = 'a'.repeat(40);

function version(id: number, createdAt: string, tags: string[]) {
  return { id, created_at: createdAt, metadata: { container: { tags } } };
}

test('GHCR retention keeps current and newest SHA releases without touching untagged manifests', () => {
  const versions = [
    version(1, '2026-07-29T10:00:00Z', [currentSha, 'stable']),
    version(2, '2026-07-28T10:00:00Z', ['b'.repeat(40)]),
    version(3, '2026-07-27T10:00:00Z', ['c'.repeat(40)]),
    version(4, '2026-07-30T10:00:00Z', []),
    version(5, '2026-07-26T10:00:00Z', ['human-tag']),
  ];
  assert.deepEqual(selectGhcrVersionsForDeletion(versions, currentSha, 2), [3]);
});

test('GHCR retention validates its immutable release contract', () => {
  assert.throws(() => selectGhcrVersionsForDeletion([], 'short', 2), /full commit SHA/);
  assert.throws(() => selectGhcrVersionsForDeletion([], currentSha, 0), /positive safe integer/);
  assert.throws(
    () => selectGhcrVersionsForDeletion([version(0, '2026-07-01T00:00:00Z', ['b'.repeat(40)])], currentSha, 1),
    /version id/,
  );
});
