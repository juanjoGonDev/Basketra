import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const dockerfile = readFileSync(new URL('../../Dockerfile', import.meta.url), 'utf8');

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
