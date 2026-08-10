import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const dockerfile = readFileSync('Dockerfile', 'utf8');
const buildScript = readFileSync('scripts/build.mjs', 'utf8');

test('Docker production artifact delegates to the canonical build script', () => {
  assert.match(buildScript, /cpSync\('src\/ai\/fixtures','dist\/ai\/fixtures',\{recursive:true\}\)/u);
  assert.match(dockerfile, /COPY scripts\/build\.mjs \.\/scripts\/build\.mjs/u);
  assert.match(dockerfile, /RUN node scripts\/build\.mjs/u);

  assert.doesNotMatch(dockerfile, /RUN tsc --noEmit && tsc -p tsconfig\.build\.json/u);
  assert.doesNotMatch(dockerfile, /cp -R src\/web dist\/web/u);
});
