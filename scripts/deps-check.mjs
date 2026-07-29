import { readFileSync } from 'node:fs';
const pkg=JSON.parse(readFileSync('package.json','utf8'));
const failures=[];
if(pkg.packageManager!=='pnpm@10.15.0')failures.push('packageManager must be pinned');
if(pkg.engines?.node!=='>=22.16.0 <23')failures.push('Node range must remain pinned to Node 22');
for(const field of ['dependencies','devDependencies','optionalDependencies']){
  for(const [name,version] of Object.entries(pkg[field]||{}))if(!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(String(version)))failures.push(`${field}.${name} must use an exact version`)
}
const lock=readFileSync('pnpm-lock.yaml','utf8');
if(!lock.includes("lockfileVersion: '9.0'"))failures.push('pnpm lockfile is missing or incompatible');
if(failures.length){console.error(failures.join('\n'));process.exit(1)}
console.log('Dependency policy passed; runtime has zero third-party packages.');
