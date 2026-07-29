import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const failures=[];
const secretPatterns=[
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /(?:api[_-]?key|password|secret)\s*[:=]\s*['"][^'"]{8,}['"]/i,
  /gh[pousr]_[A-Za-z0-9_]{30,}/,
];
function walk(path){for(const name of readdirSync(path)){if(['.git','dist','node_modules'].includes(name))continue;const file=join(path,name);const stat=statSync(file);if(stat.isDirectory())walk(file);else if(stat.size<2_000_000&&file!=='scripts/security-scan.mjs'){const text=readFileSync(file,'utf8');for(const pattern of secretPatterns)if(pattern.test(text))failures.push(`${file}: possible embedded secret`)}}}
walk('.');
const workflow=readFileSync('.github/workflows/ci.yml','utf8');
if(/pull_request_target/.test(workflow))failures.push('CI must not use pull_request_target');
if(/permissions:\s*write-all/.test(workflow))failures.push('CI must not grant write-all');
for(const match of workflow.matchAll(/uses:\s*[^\s@]+@([^\s#]+)/g))if(!/^[a-f0-9]{40}$/.test(match[1]))failures.push(`Mutable action reference: ${match[0]}`);
const compose=readFileSync('compose.yml','utf8');
for(const required of ['read_only: true','no-new-privileges:true','cap_drop:','pids_limit:','mem_limit:','127.0.0.1:'])if(!compose.includes(required))failures.push(`Compose security control missing: ${required}`);
if(failures.length){console.error(failures.join('\n'));process.exit(1)}
console.log('Security and secret scan passed.');
