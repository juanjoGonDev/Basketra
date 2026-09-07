import assert from 'node:assert/strict';
import test from 'node:test';
import {
  extractRelativeImports,
  findUnreachableTypeScriptModules,
} from '../../scripts/deadcode.mjs';

test('dead-code graph recognizes static, bare and dynamic literal imports', () => {
  assert.deepEqual(
    extractRelativeImports(`
      import './side-effect.ts';
      import { value } from './static.ts';
      const module = await import('./dynamic.ts');
      await import(variable);
      await import('node:fs');
    `),
    ['./side-effect.ts', './static.ts', './dynamic.ts'],
  );
});

test('current application graph remains reachable through dynamic bootstrap imports', () => {
  assert.deepEqual(findUnreachableTypeScriptModules(), []);
});
