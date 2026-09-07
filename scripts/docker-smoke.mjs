import { spawnSync } from 'node:child_process';

const version = spawnSync('docker', ['--version'], { encoding: 'utf8' });
if (version.status !== 0) {
  console.error('Docker is required for docker:smoke.');
  process.exit(1);
}

const build = spawnSync('docker', ['build', '-t', 'basketra:smoke', '.'], { stdio: 'inherit' });
if (build.status !== 0) process.exit(build.status ?? 1);

function runProbe(argumentsList) {
  const result = spawnSync('docker', argumentsList, { stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

runProbe([
  'run',
  '--rm',
  '--read-only',
  '--tmpfs',
  '/tmp/basketra:rw,noexec,nosuid,size=32m,mode=0700,uid=1000,gid=1000',
  'basketra:smoke',
  'node',
  'scripts/sqlite-temp-probe.mjs',
]);

runProbe([
  'run',
  '--rm',
  '--read-only',
  '--tmpfs',
  '/tmp/basketra:rw,noexec,nosuid,size=32m,mode=0500,uid=0,gid=0',
  '--tmpfs',
  '/data:rw,noexec,nosuid,size=64m,mode=0700,uid=1000,gid=1000',
  'basketra:smoke',
  'node',
  'scripts/sqlite-temp-probe.mjs',
  '--fallback',
]);

console.log('Docker smoke passed.');
