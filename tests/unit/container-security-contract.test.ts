import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const dockerfile = readFileSync(new URL('../../Dockerfile', import.meta.url), 'utf8');
const dockerSmoke = readFileSync(new URL('../../scripts/docker-smoke.mjs', import.meta.url), 'utf8');

test('runtime image upgrades OpenSSL packages before installing OCR dependencies', () => {
  const upgradeIndex = dockerfile.indexOf('apk upgrade --no-cache libcrypto3 libssl3');
  const runtimeDependencyIndex = dockerfile.indexOf('apk add --no-cache tesseract-ocr tesseract-ocr-data-spa');

  assert.notEqual(upgradeIndex, -1, 'runtime image must upgrade patched OpenSSL packages');
  assert.notEqual(runtimeDependencyIndex, -1, 'runtime OCR dependency install must remain present');
  assert.ok(
    upgradeIndex < runtimeDependencyIndex,
    'OpenSSL packages must be upgraded before runtime dependencies are installed',
  );
});

test('runtime routes SQLite temporary files into the hardened writable tmpfs', () => {
  assert.match(dockerfile, /SQLITE_TMPDIR=\/tmp\/basketra/u);
  assert.match(dockerfile, /TMPDIR=\/tmp\/basketra/u);
  assert.match(dockerSmoke, /\/tmp\/basketra:rw,noexec,nosuid,size=32m/u);
  assert.match(dockerSmoke, /PRAGMA temp_store = FILE/u);
  assert.doesNotMatch(dockerSmoke, /--tmpfs['",\s]+\/tmp:rw/u);
});
