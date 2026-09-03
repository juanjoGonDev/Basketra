import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
const typecheck = argumentsList => {
  const [command, args] = process.platform === 'win32'
    ? [process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `tsc ${argumentsList.join(' ')}`]]
    : ['tsc', argumentsList];
  execFileSync(command, args, { stdio: 'inherit' });
};
rmSync('dist',{recursive:true,force:true});
mkdirSync('dist',{recursive:true});
typecheck(['--noEmit']);
typecheck(['-p', 'tsconfig.build.json']);
cpSync('src/ai/fixtures','dist/ai/fixtures',{recursive:true});
cpSync('src/web','dist/web',{recursive:true});
cpSync('package.json','dist/package.json');
writeFileSync('dist/BUILD_INFO.json',JSON.stringify({node:process.version,builtAt:new Date().toISOString(),runtime:'compiled-javascript'},null,2)+'\n');
console.log('Production artifact created in dist/.');
