import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const failures = [];
const textFiles = [];
const ignoredDirectories = new Set(['.git', 'dist', 'node_modules', 'coverage', 'playwright-report', 'test-results']);
const secretPatterns = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /(?:api[_-]?key|password|secret)\s*[:=]\s*['"][^'"]{8,}['"]/i,
  /gh[pousr]_[A-Za-z0-9_]{30,}/,
];

function walk(path) {
  for (const name of readdirSync(path)) {
    if (ignoredDirectories.has(name)) continue;
    const file = join(path, name);
    const stat = statSync(file);
    if (stat.isDirectory()) {
      walk(file);
      continue;
    }
    if (stat.size >= 2_000_000 || file === 'scripts/security-scan.mjs') continue;
    textFiles.push(file);
  }
}

walk('.');
for (const file of textFiles) {
  const text = readFileSync(file, 'utf8');
  for (const pattern of secretPatterns) {
    if (pattern.test(text)) failures.push(`${file}: possible embedded secret`);
  }
}

const workflowDirectory = '.github/workflows';
for (const name of readdirSync(workflowDirectory)) {
  if (!/\.ya?ml$/.test(name)) continue;
  const file = join(workflowDirectory, name);
  const workflow = readFileSync(file, 'utf8');
  if (/pull_request_target/.test(workflow)) failures.push(`${file}: pull_request_target is forbidden`);
  if (/permissions:\s*write-all/.test(workflow)) failures.push(`${file}: write-all is forbidden`);
  for (const match of workflow.matchAll(/uses:\s*[^\s@]+@([^\s#]+)/g)) {
    if (!/^[a-f0-9]{40}$/.test(match[1])) failures.push(`${file}: mutable action reference: ${match[0]}`);
  }
}

const ci = readFileSync('.github/workflows/ci.yml', 'utf8');
for (const required of [
  'publish-image:',
  "github.event_name == 'push'",
  "github.ref == 'refs/heads/main'",
  'packages: write',
  'contents: read',
  'linux/amd64,linux/arm64',
  'ghcr.io/juanjogondev/basketra:${{ github.sha }}',
  'ghcr.io/juanjogondev/basketra:stable',
]) {
  if (!ci.includes(required)) failures.push(`CI publication control missing: ${required}`);
}
if (!/publish-image:[\s\S]*?needs:[\s\S]*?- quality[\s\S]*?- security[\s\S]*?- browser-e2e[\s\S]*?- container[\s\S]*?- container-smoke/.test(ci)) {
  failures.push('GHCR publication must depend on every CI gate');
}

function validateCompose(path, requiredControls) {
  const compose = readFileSync(path, 'utf8');
  for (const required of requiredControls) {
    if (!compose.includes(required)) failures.push(`${path}: security or deployment control missing: ${required}`);
  }
}

validateCompose('compose.yml', [
  'read_only: true',
  'no-new-privileges:true',
  'cap_drop:',
  'pids_limit:',
  'mem_limit:',
  '127.0.0.1:',
  'BASKETRA_AI_IMAGE_CAPABILITY:',
  'BASKETRA_AI_PDF_CAPABILITY:',
  '/readiness',
]);

validateCompose('compose.raspberry.yml', [
  'ghcr.io/juanjogondev/basketra:stable',
  'BASKETRA_AUTH_TOKEN:?BASKETRA_AUTH_TOKEN is required',
  'BASKETRA_BIND_ADDRESS:-127.0.0.1',
  'basketra-data:/data',
  'com.centurylinklabs.watchtower.enable: "true"',
  'com.centurylinklabs.watchtower.scope: basketra',
  'WATCHTOWER_SCOPE: basketra',
  'WATCHTOWER_LABEL_ENABLE: "true"',
  'WATCHTOWER_POLL_INTERVAL:',
  'BASKETRA_AI_IMAGE_CAPABILITY:',
  'BASKETRA_AI_PDF_CAPABILITY:',
  'read_only: true',
  'no-new-privileges:true',
  'cap_drop:',
  'pids_limit:',
  'mem_limit:',
  '/readiness',
]);

const raspberryCompose = readFileSync('compose.raspberry.yml', 'utf8');
if (raspberryCompose.includes('WATCHTOWER_SCHEDULE')) failures.push('Raspberry Compose must not combine Watchtower schedule and poll interval');
if (!/WATCHTOWER_POLL_INTERVAL:\s*\$\{WATCHTOWER_POLL_INTERVAL:-300\}/.test(raspberryCompose)) failures.push('Watchtower must default to a five-minute poll interval');

const environmentExample = readFileSync('.env.example', 'utf8');
for (const required of [
  'BASKETRA_AUTH_TOKEN=',
  'BASKETRA_AI_IMAGE_CAPABILITY=true',
  'BASKETRA_AI_PDF_CAPABILITY=false',
  'BASKETRA_DOCKER_CONFIG_DIR=',
  'WATCHTOWER_POLL_INTERVAL=300',
]) {
  if (!environmentExample.includes(required)) failures.push(`.env.example is incomplete: ${required}`);
}
for (const match of environmentExample.matchAll(/^(BASKETRA_AUTH_TOKEN|BASKETRA_AI_API_KEY)=(.+)$/gm)) {
  if (match[2]?.trim()) failures.push(`.env.example must not contain a value for ${match[1]}`);
}

for (const file of textFiles.filter((path) => path.endsWith('.md'))) {
  const text = readFileSync(file, 'utf8');
  if (/docker\s+login[^\n]*(?:--password(?!-stdin)|(?:^|\s)-p(?:\s|=))/.test(text)) failures.push(`${file}: unsafe docker login command`);
  if (/Authorization:\s*Bearer\s+(?!\$|\$\{|<)[A-Za-z0-9._-]{16,}/.test(text)) failures.push(`${file}: literal bearer credential in documentation`);
}

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}
console.log('Security, workflow, Compose, documentation and secret scans passed.');
