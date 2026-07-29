import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, normalize, resolve } from 'node:path';

const files=[];
function walk(path){for(const name of readdirSync(path)){const file=join(path,name);const stat=statSync(file);if(stat.isDirectory())walk(file);else if(file.endsWith('.ts')&&!file.endsWith('.d.ts'))files.push(normalize(file))}}
walk('src');
const roots=['src/main.ts','src/public-api.ts'].map(normalize);
const reachable=new Set();
function visit(file){if(reachable.has(file))return;reachable.add(file);const text=readFileSync(file,'utf8');for(const match of text.matchAll(/(?:from\s+|import\s*)['"](\.[^'"]+)['"]/g)){const candidate=normalize(resolve(dirname(file),match[1]));const relative=normalize(candidate.startsWith(process.cwd())?candidate.slice(process.cwd().length+1):candidate);if(files.includes(relative))visit(relative)}}
for(const root of roots)visit(root);
const dead=files.filter(file=>!reachable.has(file));
if(dead.length){console.error(`Unreachable TypeScript files:\n${dead.join('\n')}`);process.exit(1)}
console.log(`Dead-code graph passed for ${files.length} TypeScript modules.`);
