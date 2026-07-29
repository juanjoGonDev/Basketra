import { spawnSync } from 'node:child_process';
const version=spawnSync('docker',['--version'],{encoding:'utf8'});
if(version.status!==0){console.error('Docker is required for docker:smoke.');process.exit(1)}
const build=spawnSync('docker',['build','-t','basketra:smoke','.'],{stdio:'inherit'});if(build.status!==0)process.exit(build.status??1);
const run=spawnSync('docker',['run','--rm','--read-only','--tmpfs','/tmp:rw,noexec,nosuid,size=32m','basketra:smoke','node','-e',"import('./dist/infrastructure/config.js').then(({loadConfig})=>console.log(loadConfig({BASKETRA_DATA_DIR:'/data',BASKETRA_TEMP_DIR:'/tmp'}).host))"],{stdio:'inherit'});if(run.status!==0)process.exit(run.status??1);
console.log('Docker smoke passed.');
