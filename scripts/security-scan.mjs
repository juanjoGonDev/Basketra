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

function requireText(text, requiredValues, prefix) {
  for (const required of requiredValues) {
    if (!text.includes(required)) failures.push(`${prefix}: missing ${required}`);
  }
}

function forbidText(text, forbiddenValues, prefix) {
  for (const forbidden of forbiddenValues) {
    if (text.includes(forbidden)) failures.push(`${prefix}: forbidden ${forbidden}`);
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
requireText(ci, [
  'publish-image:',
  "github.event_name == 'push'",
  "github.ref == 'refs/heads/main'",
  'packages: write',
  'contents: read',
  'linux/amd64,linux/arm64',
  'id: publish-sha',
  'ghcr.io/juanjogondev/basketra:${{ github.sha }}',
  'steps.publish-sha.outputs.digest',
  "imagetools inspect --format '{{json .Manifest}}' \"$IMAGE:$GITHUB_SHA\"",
  'node scripts/ghcr-manifest-policy.mjs candidate',
  'docker pull --platform linux/amd64 "$IMAGE:$GITHUB_SHA"',
  'org.opencontainers.image.revision',
  'http://127.0.0.1:3001/readiness',
  'docker inspect "$container" --format \'{{.State.ExitCode}}\'',
  'id: promote',
  'imagetools create --metadata-file stable-promotion.json --tag "$IMAGE:stable"',
  'node scripts/ghcr-manifest-policy.mjs stable',
  'selectGhcrVersionsForDeletion',
  'GHCR_RETAIN_SHA_VERSIONS',
  'Delete an unpromoted failed candidate',
  '--memory-swap 192m',
  'NODE_OPTIONS=--max-old-space-size=128',
], 'CI publication or runtime contract');
if (!/publish-image:[\s\S]*?needs:[\s\S]*?- quality[\s\S]*?- security[\s\S]*?- browser-e2e[\s\S]*?- container[\s\S]*?- container-smoke/.test(ci)) {
  failures.push('GHCR publication must depend on every CI gate');
}
const publishIndex = ci.indexOf('- name: Publish immutable SHA candidate');
const verifyCandidateIndex = ci.indexOf('- name: Verify published SHA tag and manifest');
const smokeIndex = ci.indexOf('- name: Pull and smoke-test the exact published digest');
const promoteIndex = ci.indexOf('- name: Promote verified digest to stable');
const verifyStableIndex = ci.indexOf('- name: Verify stable is the validated manifest');
if (!(publishIndex >= 0 && publishIndex < verifyCandidateIndex && verifyCandidateIndex < smokeIndex && smokeIndex < promoteIndex && promoteIndex < verifyStableIndex)) {
  failures.push('GHCR candidate, digest verification, smoke, promotion and stable verification are out of order');
}
if (publishIndex >= 0 && verifyCandidateIndex >= 0 && ci.slice(publishIndex, verifyCandidateIndex).includes('basketra:stable')) {
  failures.push('The build-push action must not publish stable before candidate verification');
}
if (/docker\/build-push-action@[\s\S]*?tags:\s*\|?[\s\S]*?basketra:stable/.test(ci.slice(publishIndex, verifyCandidateIndex))) {
  failures.push('The initial Buildx publication must contain only the immutable SHA tag');
}
if (/CR_PAT|PERSONAL_ACCESS_TOKEN|GHCR_PAT/.test(ci)) failures.push('CI must use GITHUB_TOKEN rather than a personal access token');

function validateCompose(path, requiredControls) {
  const compose = readFileSync(path, 'utf8');
  requireText(compose, requiredControls, path);
  forbidText(compose, ['BASKETRA_AUTH_TOKEN'], path);
}

validateCompose('compose.yml', [
  'read_only: true',
  'no-new-privileges:true',
  'cap_drop:',
  'pids_limit:',
  'mem_limit:',
  'memswap_limit:',
  '127.0.0.1:',
  'NODE_OPTIONS: --max-old-space-size=${BASKETRA_NODE_HEAP_MB:-128}',
  'BASKETRA_AI_IMAGE_CAPABILITY:',
  'BASKETRA_AI_PDF_CAPABILITY:',
  '/readiness',
]);

validateCompose('compose.raspberry.yml', [
  'ghcr.io/juanjogondev/basketra:stable',
  'BASKETRA_BIND_ADDRESS:-127.0.0.1',
  'basketra-data:/data',
  'com.centurylinklabs.watchtower.enable: "true"',
  'com.centurylinklabs.watchtower.scope: basketra',
  'WATCHTOWER_SCOPE: basketra',
  'WATCHTOWER_LABEL_ENABLE: "true"',
  'WATCHTOWER_POLL_INTERVAL:',
  'WATCHTOWER_CLEANUP: "true"',
  'WATCHTOWER_REMOVE_VOLUMES: "false"',
  'NODE_OPTIONS: --max-old-space-size=${BASKETRA_NODE_HEAP_MB:-128}',
  'BASKETRA_AI_IMAGE_CAPABILITY:',
  'BASKETRA_AI_PDF_CAPABILITY:',
  'read_only: true',
  'no-new-privileges:true',
  'cap_drop:',
  'pids_limit:',
  'mem_limit:',
  'memswap_limit:',
  '/readiness',
]);

const raspberryCompose = readFileSync('compose.raspberry.yml', 'utf8');
if (raspberryCompose.includes('WATCHTOWER_SCHEDULE')) failures.push('Raspberry Compose must not combine Watchtower schedule and poll interval');
if (!/WATCHTOWER_POLL_INTERVAL:\s*\$\{WATCHTOWER_POLL_INTERVAL:-300\}/.test(raspberryCompose)) failures.push('Watchtower must default to a five-minute poll interval');

const environmentExample = readFileSync('.env.example', 'utf8');
requireText(environmentExample, [
  'BASKETRA_BIND_ADDRESS=127.0.0.1',
  'BASKETRA_AI_IMAGE_CAPABILITY=true',
  'BASKETRA_AI_PDF_CAPABILITY=false',
  'BASKETRA_NODE_HEAP_MB=128',
  'BASKETRA_MEMORY_LIMIT=192m',
  'BASKETRA_DOCKER_CONFIG_DIR=',
  'WATCHTOWER_POLL_INTERVAL=300',
], '.env.example');
forbidText(environmentExample, ['BASKETRA_AUTH_TOKEN'], '.env.example');
for (const match of environmentExample.matchAll(/^(BASKETRA_AI_API_KEY)=(.+)$/gm)) {
  if (match[2]?.trim()) failures.push(`.env.example must not contain a value for ${match[1]}`);
}

const config = readFileSync('src/infrastructure/config.ts', 'utf8');
forbidText(config, ['authToken', 'BASKETRA_AUTH_TOKEN'], 'application configuration');
const server = readFileSync('src/api/server.ts', 'utf8');
forbidText(server, ['timingSafeEqual', 'A valid local access token is required'], 'HTTP server');
requireText(server, [
  "url.pathname === '/api/v1/meta'",
  'private, no-store, max-age=0',
  'INVALID_STORAGE_KEY',
  'itemOrderMatch',
], 'HTTP private workflow contract');

const database = readFileSync('src/infrastructure/database.ts', 'utf8');
requireText(database, [
  'maxDatabaseBytes: 512 * 1024 * 1024',
  'maxSqliteCacheBytes: 8 * 1024 * 1024',
  'maxWalBytes: 16 * 1024 * 1024',
  'migrationBackupRetention: Object.freeze({ maxCount: 3, maxBytes: 768 * 1024 * 1024 })',
  'manualBackupRetention: Object.freeze({ maxCount: 5, maxBytes: 768 * 1024 * 1024 })',
  'PRAGMA max_page_count',
  'PRAGMA cache_size',
  'PRAGMA journal_size_limit',
  'pruneBackupDirectory',
  'ALTER TABLE shopping_list_items ADD COLUMN completed',
  'BEGIN IMMEDIATE',
  '.tmp',
], 'database storage contract');

const files = readFileSync('src/infrastructure/files.ts', 'utf8');
requireText(files, [
  'SUPPORTED_FILE_MIME_TYPES',
  'DEFAULT_FILE_STORAGE_MAX_BYTES = 512 * 1024 * 1024',
  'Persistent file storage limit would be exceeded',
  'File signature does not match MIME type',
  'cleanupTemporary()',
  'finally',
], 'file storage contract');

const webApi = readFileSync('src/web/api.js', 'utf8');
forbidText(webApi, ['Bearer', 'authorization', 'authToken'], 'browser HTTP client');
const serviceWorker = readFileSync('src/web/sw.js', 'utf8');
requireText(serviceWorker, ["url.pathname.startsWith('/api/')", "'/lists.js'", "'/receipts.js'"], 'PWA cache contract');

const aiProvider = readFileSync('src/ai/provider.ts', 'utf8');
requireText(aiProvider, [
  'DEFAULT_AI_MAX_RESPONSE_BYTES = 1024 * 1024',
  'AI_RESPONSE_TOO_LARGE',
  'response.body.getReader()',
  'reader.cancel',
], 'AI response contract');

const resourceScript = readFileSync('scripts/resource-measure.mjs', 'utf8');
requireText(resourceScript, [
  'MAX_STEADY_STATE_RSS_GROWTH_BYTES',
  'MAX_STEADY_STATE_HEAP_GROWTH_BYTES',
  'MAX_IDEMPOTENT_STORAGE_GROWTH_BYTES',
  "if (!hibernated) throw new Error",
  'assertAtMost',
], 'resource growth contract');
const packageJson = readFileSync('package.json', 'utf8');
if (!packageJson.includes('node --expose-gc scripts/resource-measure.mjs')) failures.push('Resource measurement must expose deterministic garbage collection');

for (const requiredTest of [
  'tests/integration/storage-limits.test.ts',
  'tests/integration/shopping-lists.test.ts',
  'tests/unit/storage-limits.test.ts',
  'tests/unit/ai-response-limits.test.ts',
  'tests/unit/ghcr-retention.test.ts',
  'tests/unit/ghcr-manifest-policy.test.ts',
]) {
  if (!textFiles.includes(requiredTest)) failures.push(`Missing bounded-resource, workflow or publication regression test: ${requiredTest}`);
}

for (const requiredScript of [
  'scripts/ghcr-retention-policy.mjs',
  'scripts/ghcr-manifest-policy.mjs',
]) {
  if (!textFiles.includes(requiredScript)) failures.push(`Missing GHCR policy implementation: ${requiredScript}`);
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
console.log('Security, workflow, bounded-resource, private-network, Compose, documentation and secret scans passed.');
