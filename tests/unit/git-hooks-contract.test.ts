import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const packageJson = JSON.parse(readFileSync('package.json', 'utf8')) as Record<string, unknown>;
const scripts = packageJson['scripts'] as Record<string, string>;
const devDependencies = packageJson['devDependencies'] as Record<string, string>;
const lefthook = readFileSync('lefthook.yml', 'utf8');
const installer = readFileSync('scripts/install-hooks.mjs', 'utf8');
const tsconfig = JSON.parse(readFileSync('tsconfig.json', 'utf8')) as Record<string, unknown>;

test('local Git hooks use pinned development tooling and canonical quality gates', () => {
  assert.equal(devDependencies['lefthook'], '2.1.8');
  assert.equal(devDependencies['@types/node'], '22.20.1');
  assert.equal(scripts['postinstall'], 'node scripts/install-hooks.mjs');
  assert.equal(scripts['hook:pre-commit'], 'lefthook run pre-commit');
  assert.equal(scripts['hook:pre-push'], 'lefthook run pre-push');

  assert.match(lefthook, /pre-commit:/u);
  assert.match(lefthook, /parallel: true/u);
  assert.match(lefthook, /run: pnpm format:check/u);
  assert.match(lefthook, /run: pnpm lint/u);
  assert.match(lefthook, /run: node scripts\/security-scan\.mjs/u);
  assert.match(lefthook, /pre-push:/u);
  assert.match(lefthook, /run: pnpm quality/u);
});

test('hook installation is skipped outside a safe local Git checkout', () => {
  assert.match(installer, /SKIP_GIT_HOOKS/u);
  assert.match(installer, /process\.env\['CI'\] === 'true'/u);
  assert.match(installer, /process\.env\['NODE_ENV'\] === 'production'/u);
  assert.match(installer, /existsSync\('\.git'\)/u);
  assert.match(installer, /spawnSync\('git', \['--version'\]/u);
  assert.match(installer, /spawnSync\('lefthook', \['install'\]/u);
});

test('editor Node typings do not override repository-owned source declarations', () => {
  const compilerOptions = tsconfig['compilerOptions'] as Record<string, unknown>;
  assert.deepEqual(compilerOptions['types'], []);
  assert.deepEqual(tsconfig['include'], ['src/**/*.ts']);
});
