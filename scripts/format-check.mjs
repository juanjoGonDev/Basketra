import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const roots=['src','tests','scripts','docs','.agents','.github'];
const extensions=new Set(['.ts','.js','.mjs','.json','.md','.yml','.yaml','.css','.html','.svg','.webmanifest']);
const failures=[];
function walk(path){for(const name of readdirSync(path)){const file=join(path,name);const stat=statSync(file);if(stat.isDirectory())walk(file);else if([...extensions].some(ext=>file.endsWith(ext))){const text=readFileSync(file,'utf8');if(text.includes('\r\n'))failures.push(`${file}: CRLF is not allowed`);if(!text.endsWith('\n'))failures.push(`${file}: missing final newline`);text.split('\n').forEach((line,index)=>{if(/[ \t]+$/.test(line))failures.push(`${file}:${index+1}: trailing whitespace`)})}}}
for(const root of roots)walk(root);
if(failures.length){console.error(failures.join('\n'));process.exit(1)}
console.log('Format check passed.');
