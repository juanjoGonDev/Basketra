import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { loadConfig } from '../../src/infrastructure/config.ts';

const packageJson = JSON.parse(readFileSync('package.json', 'utf8')) as Record<string, unknown>;
const scripts = packageJson['scripts'] as Record<string, string>;
const volta = packageJson['volta'] as Record<string, string>;
const compose = readFileSync('compose.yml', 'utf8');

const LEGACY_APPLICATION_ENV = [
  'BASKETRA_HOST',
  'BASKETRA_PORT',
  'BASKETRA_DATA_DIR',
  'BASKETRA_TEMP_DIR',
  'BASKETRA_MAX_BODY_BYTES',
  'BASKETRA_AI_BASE_URL',
  'BASKETRA_AI_API_KEY',
  'BASKETRA_AI_MODEL',
  'BASKETRA_AI_MAX_RETRIES',
  'BASKETRA_AI_IMAGE_CAPABILITY',
  'BASKETRA_AI_PDF_CAPABILITY',
  'BASKETRA_OVERPASS_BASE_URL',
  'BASKETRA_IDLE_HIBERNATE_AFTER_MS',
  'IDLE_EXIT_AFTER_MS',
] as const;

test('development scripts expose native preflight and zero-env Docker runtime parity', () => {
  assert.equal(volta['node'], '22.23.1');
  assert.equal(scripts['predev'], 'node scripts/check-dev-runtime.mjs');
  assert.equal(
    scripts['dev'],
    'node --experimental-strip-types --watch src/main.ts',
  );
  assert.equal(
    scripts['dev:docker'],
    'docker compose up --build --force-recreate basketra',
  );
  assert.equal(scripts['dev:docker:down'], 'docker compose down');
  assert.match(compose, /host\.docker\.internal:host-gateway/u);
  assert.doesNotMatch(compose, /\$\{/u);
  assert.doesNotMatch(compose, /^\s*environment:/mu);
});

test('legacy Basketra application environment variables cannot change bootstrap configuration', () => {
  const before = loadConfig();
  const previous = new Map<string, string | undefined>();
  try {
    for (const key of LEGACY_APPLICATION_ENV) {
      previous.set(key, process.env[key]);
      process.env[key] = `ignored-${key.toLowerCase()}`;
    }
    assert.deepEqual(loadConfig(), before);
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
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
