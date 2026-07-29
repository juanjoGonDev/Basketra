import { existsSync, mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { performance } from 'node:perf_hooks';
import { BasketraServer } from '../dist/api/server.js';

const MIB = 1024 * 1024;
const MAX_IDLE_RSS_BYTES = 96 * MIB;
const MAX_ACTIVE_RSS_BYTES = 144 * MIB;
const MAX_HEAP_USED_BYTES = 64 * MIB;
const MAX_STEADY_STATE_RSS_GROWTH_BYTES = 24 * MIB;
const MAX_STEADY_STATE_HEAP_GROWTH_BYTES = 8 * MIB;
const MAX_IDEMPOTENT_STORAGE_GROWTH_BYTES = 64 * 1024;
const MAX_IDLE_CPU_PERCENT = 1;
const MAX_STARTUP_MS = 5_000;
const MAX_SHUTDOWN_MS = 20_000;

function assertAtMost(actual, maximum, name) {
  if (actual > maximum) throw new Error(`${name} exceeded its limit: ${actual} > ${maximum}`);
}

function directoryBytes(path) {
  if (!existsSync(path)) return 0;
  return readdirSync(path, { withFileTypes: true }).reduce((total, entry) => {
    const child = join(path, entry.name);
    return total + (entry.isDirectory() ? directoryBytes(child) : statSync(child).size);
  }, 0);
}

async function settleMemory() {
  await new Promise((resolve) => setTimeout(resolve, 25));
  global.gc?.();
  await new Promise((resolve) => setImmediate(resolve));
}

async function exerciseRound(base, round) {
  for (let index = 0; index < 100; index += 1) {
    const response = await fetch(`${base}/api/v1/shopping-lists`);
    if (!response.ok) throw new Error(`Representative list request failed: ${response.status}`);
  }
  for (let index = 0; index < 20; index += 1) {
    const body = {
      importKey: `resource-receipt-${index}`,
      originalText: 'Milk',
      declaredTotalMinor: 120,
      items: [{ description: 'Milk', quantity: 1, unitPriceMinor: 120, lineTotalMinor: 120 }],
    };
    const response = await fetch(`${base}/api/v1/receipts/confirm`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(`Representative receipt request failed in round ${round}: ${response.status}`);
  }
}

const root = mkdtempSync(join(tmpdir(), 'basketra-resource-'));
const config = {
  host: '127.0.0.1',
  port: 0,
  dataDir: join(root, 'data'),
  tempDir: join(root, 'tmp'),
  maxBodyBytes: 1024 * 1024,
  aiTimeoutMs: 1000,
  aiMaxRetries: 0,
  aiImageCapability: true,
  aiPdfCapability: false,
  idleHibernateAfterMs: 20,
  idleExitAfterMs: 0,
};

let server;
try {
  const before = performance.now();
  server = new BasketraServer(config);
  await server.listen();
  const startupMs = performance.now() - before;
  const base = `http://127.0.0.1:${server.address().port}`;
  const health = await fetch(`${base}/health`);
  if (!health.ok) throw new Error(`Health request failed: ${health.status}`);

  await settleMemory();
  const idle = process.memoryUsage();
  const rounds = [];
  for (let round = 0; round < 3; round += 1) {
    await exerciseRound(base, round);
    await settleMemory();
    rounds.push({ memory: process.memoryUsage(), storageBytes: directoryBytes(config.dataDir) });
  }

  const cpuBefore = process.cpuUsage();
  const idleStart = performance.now();
  await new Promise((resolve) => setTimeout(resolve, 2_000));
  const idleWallMs = performance.now() - idleStart;
  const cpuDelta = process.cpuUsage(cpuBefore);
  const idleCpuPercent = ((cpuDelta.user + cpuDelta.system) / (idleWallMs * 1000)) * 100;
  await settleMemory();
  const returnedToIdle = process.memoryUsage();
  const hibernated = server.diagnostics().hibernated;
  if (!hibernated) throw new Error('Server did not release optional resources after the idle interval');
  const firstRound = rounds[0];
  const finalRound = rounds.at(-1);
  if (!firstRound || !finalRound) throw new Error('Resource measurement rounds were not recorded');

  assertAtMost(startupMs, MAX_STARTUP_MS, 'startupMs');
  assertAtMost(idle.rss, MAX_IDLE_RSS_BYTES, 'idleRssBytes');
  assertAtMost(Math.max(...rounds.map((entry) => entry.memory.rss)), MAX_ACTIVE_RSS_BYTES, 'activeRssBytes');
  assertAtMost(Math.max(...rounds.map((entry) => entry.memory.heapUsed)), MAX_HEAP_USED_BYTES, 'heapUsedBytes');
  assertAtMost(finalRound.memory.rss - firstRound.memory.rss, MAX_STEADY_STATE_RSS_GROWTH_BYTES, 'steadyStateRssGrowthBytes');
  assertAtMost(finalRound.memory.heapUsed - firstRound.memory.heapUsed, MAX_STEADY_STATE_HEAP_GROWTH_BYTES, 'steadyStateHeapGrowthBytes');
  assertAtMost(finalRound.storageBytes - firstRound.storageBytes, MAX_IDEMPOTENT_STORAGE_GROWTH_BYTES, 'idempotentStorageGrowthBytes');
  assertAtMost(idleCpuPercent, MAX_IDLE_CPU_PERCENT, 'idleCpuPercent');

  const threadCount = readdirSync('/proc/self/task').length;
  const shutdownStart = performance.now();
  await server.close();
  server = undefined;
  const shutdownMs = performance.now() - shutdownStart;
  assertAtMost(shutdownMs, MAX_SHUTDOWN_MS, 'shutdownMs');

  console.log(JSON.stringify({
    startupMs,
    shutdownMs,
    idleRssBytes: idle.rss,
    peakRoundRssBytes: Math.max(...rounds.map((entry) => entry.memory.rss)),
    returnedToIdleRssBytes: returnedToIdle.rss,
    firstRoundHeapUsedBytes: firstRound.memory.heapUsed,
    finalRoundHeapUsedBytes: finalRound.memory.heapUsed,
    steadyStateHeapGrowthBytes: finalRound.memory.heapUsed - firstRound.memory.heapUsed,
    steadyStateRssGrowthBytes: finalRound.memory.rss - firstRound.memory.rss,
    firstRoundStorageBytes: firstRound.storageBytes,
    finalRoundStorageBytes: finalRound.storageBytes,
    idempotentStorageGrowthBytes: finalRound.storageBytes - firstRound.storageBytes,
    idleCpuPercent,
    primaryProcessCount: 1,
    threadCount,
    hibernated,
  }, null, 2));
} finally {
  if (server) await server.close().catch(() => undefined);
  rmSync(root, { recursive: true, force: true });
}
