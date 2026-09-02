import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { validateGhcrWorkflows } from './ghcr-workflow-policy.mjs';

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
const ghcrPublication = readFileSync('.github/workflows/publish-ghcr.yml', 'utf8');
failures.push(...validateGhcrWorkflows(ci, ghcrPublication));

function validateCompose(path, requiredControls) {
  const compose = readFileSync(path, 'utf8');
  requireText(compose, requiredControls, path);
  forbidText(compose, ['BASKETRA_', '${'], path);
}

validateCompose('compose.yml', [
  'command: ["node", "--max-old-space-size=128", "dist/main.js"]',
  'read_only: true',
  'no-new-privileges:true',
  'cap_drop:',
  'pids_limit: 128',
  'mem_limit: 192m',
  'memswap_limit: 192m',
  'cpus: 0.75',
  '127.0.0.1:3000:3000',
  'host.docker.internal:host-gateway',
  'basketra-data:/data',
  '/readiness',
]);

validateCompose('compose.raspberry.yml', [
  'ghcr.io/juanjogondev/basketra:stable',
  'command: ["node", "--max-old-space-size=128", "dist/main.js"]',
  '127.0.0.1:3000:3000',
  'host.docker.internal:host-gateway',
  'basketra-data:/data',
  'com.centurylinklabs.watchtower.enable: "true"',
  'com.centurylinklabs.watchtower.scope: basketra',
  'WATCHTOWER_SCOPE: basketra',
  'WATCHTOWER_LABEL_ENABLE: "true"',
  'WATCHTOWER_POLL_INTERVAL: "300"',
  'WATCHTOWER_CLEANUP: "true"',
  'WATCHTOWER_REMOVE_VOLUMES: "false"',
  'read_only: true',
  'no-new-privileges:true',
  'cap_drop:',
  'pids_limit: 128',
  'mem_limit: 192m',
  'memswap_limit: 192m',
  'cpus: 0.75',
  '/readiness',
]);

const raspberryCompose = readFileSync('compose.raspberry.yml', 'utf8');
if (raspberryCompose.includes('WATCHTOWER_SCHEDULE')) failures.push('Raspberry Compose must not combine Watchtower schedule and poll interval');
if (!/WATCHTOWER_POLL_INTERVAL:\s*"300"/.test(raspberryCompose)) failures.push('Watchtower must use the fixed five-minute poll interval');

const config = readFileSync('src/infrastructure/config.ts', 'utf8');
requireText(config, ["existsSync('/.dockerenv')", "host: '0.0.0.0'", "host: '127.0.0.1'"], 'application bootstrap configuration');
forbidText(config, ['authToken', 'BASKETRA_AUTH_TOKEN', 'process.env', 'BASKETRA_'], 'application bootstrap configuration');
const server = readFileSync('src/api/server.ts', 'utf8');
forbidText(server, ['timingSafeEqual', 'A valid local access token is required'], 'HTTP server');
requireText(server, [
  "url.pathname === '/api/v1/meta'",
  "url.pathname === '/api/v1/settings/runtime'",
  'private, no-store, max-age=0',
  'INVALID_STORAGE_KEY',
  'itemOrderMatch',
], 'HTTP private workflow contract');

const runtimeSettings = readFileSync('src/infrastructure/runtime-settings.ts', 'utf8');
requireText(runtimeSettings, ['RuntimeSettingsStore', 'aiBaseUrl', 'aiApiKey', 'aiModel', 'aiMaxRetries', 'overpassBaseUrl', 'maxBodyBytes', 'idleHibernateAfterMs'], 'SQLite runtime settings contract');
const gateway = readFileSync('src/operations/gateway.ts', 'utf8');
requireText(gateway, [
  "url.pathname === '/api/v1/runtime'",
  "url.pathname === '/api/v1/logs'",
  "url.pathname === '/api/v1/restore/import'",
  "url.pathname === '/api/v1/restore/stage'",
  'MAX_CLIENT_LOG_BATCH',
  'MAX_CLIENT_LOGS_PER_MINUTE',
  'AI_LOOPBACK_CONTAINER',
  'host.docker.internal',
  'requiresContainerRecreate: false',
], 'operations gateway contract');
forbidText(gateway, ['process.env.BASKETRA_AI_API_KEY', 'receipt.raw_text'], 'operations gateway');
const logStore = readFileSync('src/operations/log-store.ts', 'utf8');
requireText(logStore, ['10_000', '40 * 1024 * 1024', 'sanitizeClientLog', 'MAX_EVENT_BYTES'], 'bounded application logs');
const restore = readFileSync('src/operations/restore.ts', 'utf8');
requireText(restore, ['RESTORE_CONFIRMATION', 'validateBackup', 'restore-pending.json', 'restore-failed-'], 'staged restore contract');

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
requireText(webApi, ['basketra:api-log', "import('./operations.js')"], 'browser observability contract');
const operationsUi = readFileSync('src/web/operations.js', 'utf8');
requireText(operationsUi, ['client.connection_restored', 'setInterval(updateUptime, 1000)', 'RESTAURAR', '/api/v1/logs/client', '/api/v1/settings/runtime', 'runtimeSettingsPayload'], 'browser operations contract');
forbidText(operationsUi, ['BASKETRA_AI_BASE_URL', 'BASKETRA_AI_API_KEY', 'BASKETRA_AI_MODEL', 'recrea el contenedor', 'recrear el contenedor'], 'browser runtime settings UX');
const serviceWorker = readFileSync('src/web/sw.js', 'utf8');
requireText(serviceWorker, ["url.pathname.startsWith('/api/')", "'/lists.js'", "'/receipts.js'", "'/operations.js'", "'/operations.css'"], 'PWA cache contract');

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
  'tests/integration/operations-gateway.test.ts',
  'tests/unit/storage-limits.test.ts',
  'tests/unit/ai-response-limits.test.ts',
  'tests/unit/ghcr-retention.test.ts',
  'tests/unit/ghcr-manifest-policy.test.ts',
  'tests/unit/ghcr-workflow-policy.test.ts',
  'tests/unit/runtime-operations.test.ts',
  'tests/unit/local-runtime-contract.test.ts',
  'tests/unit/release-version-policy.test.ts',
]) {
  if (!textFiles.includes(requiredTest)) failures.push(`Missing bounded-resource, workflow or publication regression test: ${requiredTest}`);
}

for (const requiredScript of [
  'scripts/ghcr-retention-policy.mjs',
  'scripts/ghcr-manifest-policy.mjs',
  'scripts/ghcr-workflow-policy.mjs',
  'scripts/release-version-policy.mjs',
]) {
  if (!textFiles.includes(requiredScript)) failures.push(`Missing GHCR or release policy implementation: ${requiredScript}`);
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
console.log('Security, workflow, release, observability, backup, bounded-resource, zero-env private-network and secret scans passed.');
