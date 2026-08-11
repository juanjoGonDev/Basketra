import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const packageJson = JSON.parse(readFileSync('package.json', 'utf8')) as Record<string, unknown>;
const scripts = packageJson['scripts'] as Record<string, string>;
const volta = packageJson['volta'] as Record<string, string>;
const compose = readFileSync('compose.yml', 'utf8');

test('development scripts expose native preflight and Docker runtime parity', () => {
  assert.equal(volta['node'], '22.23.1');
  assert.equal(scripts['predev'], 'node scripts/check-dev-runtime.mjs');
  assert.equal(
    scripts['dev'],
    'node --env-file-if-exists=.env --experimental-strip-types --watch src/main.ts',
  );
  assert.equal(
    scripts['dev:docker'],
    'docker compose up --build --force-recreate basketra',
  );
  assert.equal(scripts['dev:docker:down'], 'docker compose down');
  assert.match(compose, /host\.docker\.internal:host-gateway/u);
});

test('canonical CI Node runtime provides the SQLite FTS5 requirement', () => {
  const result = spawnSync(process.execPath, ['scripts/check-dev-runtime.mjs'], {
    encoding: 'utf8',
  });

  assert.equal(
    result.status,
    0,
    `runtime preflight failed: ${result.stderr || result.stdout}`,
  );
});
