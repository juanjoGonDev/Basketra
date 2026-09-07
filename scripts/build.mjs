import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const VERSION_PLACEHOLDER = '__BASKETRA_VERSION__';
const SEMANTIC_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

const typecheck = argumentsList => {
  const [command, args] = process.platform === 'win32'
    ? [process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `tsc ${argumentsList.join(' ')}`]]
    : ['tsc', argumentsList];
  execFileSync(command, args, { stdio: 'inherit' });
};

function resolveBuildVersion() {
  const value = (process.env.BASKETRA_VERSION || '0.0.0-dev').trim();
  if (!SEMANTIC_VERSION.test(value)) throw new Error(`Invalid BASKETRA_VERSION: ${value || '<empty>'}`);
  return value;
}

function stampVersion(path, version) {
  const source = readFileSync(path, 'utf8');
  if (!source.includes(VERSION_PLACEHOLDER)) throw new Error(`Missing ${VERSION_PLACEHOLDER} in ${path}`);
  writeFileSync(path, source.replaceAll(VERSION_PLACEHOLDER, version));
}

const version = resolveBuildVersion();
rmSync('dist',{recursive:true,force:true});
mkdirSync('dist',{recursive:true});
typecheck(['--noEmit']);
typecheck(['-p', 'tsconfig.build.json']);
cpSync('src/ai/fixtures','dist/ai/fixtures',{recursive:true});
cpSync('src/web','dist/web',{recursive:true});
stampVersion('dist/web/sw.js', version);
stampVersion('dist/web/manifest.webmanifest', version);
cpSync('package.json','dist/package.json');
writeFileSync('dist/BUILD_INFO.json',JSON.stringify({node:process.version,builtAt:new Date().toISOString(),runtime:'compiled-javascript',version},null,2)+'\n');
console.log(`Production artifact created in dist/ for Basketra ${version}.`);
