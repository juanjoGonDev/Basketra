import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const dockerfile = readFileSync(new URL('../../Dockerfile', import.meta.url), 'utf8');
const dockerSmoke = readFileSync(new URL('../../scripts/docker-smoke.mjs', import.meta.url), 'utf8');
const sqliteTempProbe = readFileSync(new URL('../../scripts/sqlite-temp-probe.mjs', import.meta.url), 'utf8');
const runtimeTempSource = readFileSync(new URL('../../src/infrastructure/runtime-temp.ts', import.meta.url), 'utf8');
const mainSource = readFileSync(new URL('../../src/main.ts', import.meta.url), 'utf8');
const ciWorkflow = readFileSync(new URL('../../.github/workflows/ci.yml', import.meta.url), 'utf8');
const publishWorkflow = readFileSync(new URL('../../.github/workflows/publish-ghcr.yml', import.meta.url), 'utf8');

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

test('runtime routes SQLite temporary files into one canonical hardened probe', () => {
  assert.match(dockerfile, /SQLITE_TMPDIR=\/tmp\/basketra/u);
  assert.match(dockerfile, /TMPDIR=\/tmp\/basketra/u);
  assert.match(
    dockerfile,
    /COPY --chown=node:node scripts\/sqlite-temp-probe\.mjs \.\/scripts\/sqlite-temp-probe\.mjs/u,
  );
  assert.match(dockerSmoke, /\/tmp\/basketra:rw,noexec,nosuid,size=32m,mode=0700,uid=1000,gid=1000/u);
  assert.doesNotMatch(dockerSmoke, /--tmpfs['",\s]+\/tmp:rw/u);
  assert.match(runtimeTempSource, /PRAGMA temp_store = FILE/u);
  assert.match(runtimeTempSource, /PRAGMA temp\.cache_size = 1/u);
  assert.match(runtimeTempSource, /zeroblob\(\?\)/u);
  assert.match(sqliteTempProbe, /\.\.\/dist\/infrastructure\/runtime-temp\.js/u);
  assert.doesNotMatch(sqliteTempProbe, /PRAGMA temp_store = FILE/u);

  const prepareIndex = mainSource.indexOf('prepareRuntimeTempStorage(');
  const restoreIndex = mainSource.indexOf('applyPendingRestore(');
  assert.ok(prepareIndex >= 0);
  assert.ok(restoreIndex > prepareIndex);

  assert.match(dockerSmoke, /mode=0500,uid=0,gid=0/u);
  assert.match(dockerSmoke, /'--fallback'/u);
  for (const owner of [ciWorkflow, publishWorkflow]) {
    assert.match(owner, /mode=0500,uid=0,gid=0/u);
    assert.match(owner, /data-fallback/u);
    assert.match(owner, /DATA_FALLBACK/u);
  }
  for (const owner of [dockerSmoke, ciWorkflow, publishWorkflow, sqliteTempProbe]) {
    assert.doesNotMatch(owner, /PRAGMA temp_store = FILE/u);
  }
});
