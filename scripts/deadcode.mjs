import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, normalize, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const RELATIVE_IMPORT = /(?:from\s+|import\s*(?:\(\s*)?)['"](\.[^'"]+)['"]\s*\)?/gu;

export function extractRelativeImports(source) {
  return [...source.matchAll(RELATIVE_IMPORT)].map((match) => match[1]);
}

export function findUnreachableTypeScriptModules(rootDirectory = 'src') {
  const files = [];
  function walk(path) {
    for (const name of readdirSync(path)) {
      const file = join(path, name);
      const stat = statSync(file);
      if (stat.isDirectory()) walk(file);
      else if (file.endsWith('.ts') && !file.endsWith('.d.ts')) files.push(normalize(file));
    }
  }
  walk(rootDirectory);

  const roots = ['src/main.ts', 'src/public-api.ts'].map(normalize);
  const reachable = new Set();
  function visit(file) {
    if (reachable.has(file)) return;
    reachable.add(file);
    const text = readFileSync(file, 'utf8');
    for (const specifier of extractRelativeImports(text)) {
      const candidate = normalize(resolve(dirname(file), specifier));
      const relative = normalize(
        candidate.startsWith(process.cwd())
          ? candidate.slice(process.cwd().length + 1)
          : candidate,
      );
      if (files.includes(relative)) visit(relative);
    }
  }
  for (const root of roots) visit(root);
  return files.filter((file) => !reachable.has(file));
}

const invokedPath = process.argv[1];
if (invokedPath && import.meta.url === pathToFileURL(invokedPath).href) {
  const dead = findUnreachableTypeScriptModules();
  if (dead.length) {
    console.error(`Unreachable TypeScript files:\n${dead.join('\n')}`);
    process.exit(1);
  }
  console.log('Dead-code graph passed.');
}
