import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const failures=[];
function walk(path){for(const name of readdirSync(path)){const file=join(path,name);const stat=statSync(file);if(stat.isDirectory())walk(file);else if(/\.(?:ts|js|mjs)$/.test(file)&&file!=='scripts/lint.mjs'){const text=readFileSync(file,'utf8');const rules=[[/\b(?:TODO|FIXME)\b/g,'unfinished marker'],[/\.(?:only|skip)\s*\(/g,'focused or skipped test'],[/\bas\s+any\b|:\s*any\b/g,'unsafe any'],[/eslint-disable/g,'lint bypass']];for(const [pattern,label] of rules){for(const match of text.matchAll(pattern)){const line=text.slice(0,match.index).split('\n').length;failures.push(`${file}:${line}: ${label}`)}}}}}
walk('src');walk('tests');walk('scripts');
if(failures.length){console.error(failures.join('\n'));process.exit(1)}
console.log('Lint checks passed.');
