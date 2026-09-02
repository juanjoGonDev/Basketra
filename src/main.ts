import { join } from 'node:path';
import { installAiRuntimeCapabilitiesCache } from './ai/runtime-capabilities-cache.ts';
import { loadConfig } from './infrastructure/config.ts';
import { OperationsGateway } from './operations/gateway.ts';
import { applyPendingRestore } from './operations/restore.ts';

const config = loadConfig();
const restore = await applyPendingRestore(config.dataDir);
if (restore.status === 'applied') {
  console.log(JSON.stringify({ level: 'info', event: 'restore_applied', importedName: restore.importedName }));
}
if (restore.status === 'failed') {
  process.stderr.write(`${JSON.stringify({
    level: 'error',
    event: 'restore_failed',
    errorCode: restore.errorCode,
    ...(restore.importedName ? { importedName: restore.importedName } : {}),
  })}\n`);
}

let shuttingDown = false;
let gateway: OperationsGateway;
let uninstallAiRuntimeCapabilitiesCache: (() => void) | undefined;

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  const deadline = setTimeout(() => process.exit(1), 15_000);
  deadline.unref();
  try {
    await gateway.close();
    uninstallAiRuntimeCapabilitiesCache?.();
    uninstallAiRuntimeCapabilitiesCache = undefined;
    clearTimeout(deadline);
    process.exitCode = 0;
  } catch (error) {
    process.stderr.write(`${JSON.stringify({
      level: 'error',
      event: 'shutdown_failed',
      signal,
      errorName: error instanceof Error ? error.name : typeof error,
    })}\n`);
    process.exitCode = 1;
  }
}

gateway = new OperationsGateway(config, {
  requestRestart: () => void shutdown('RESTORE_STAGED'),
});
if (config.aiBaseUrl && config.aiModel) {
  uninstallAiRuntimeCapabilitiesCache = installAiRuntimeCapabilitiesCache({
    databasePath: join(config.dataDir, 'basketra.db'),
    baseUrl: new URL(config.aiBaseUrl),
    model: config.aiModel,
  });
}

process.once('SIGTERM', () => void shutdown('SIGTERM'));
process.once('SIGINT', () => void shutdown('SIGINT'));

await gateway.listen();
const address = gateway.address();
console.log(JSON.stringify({ level: 'info', event: 'server_started', host: address.host, port: address.port }));

if (config.idleExitAfterMs > 0) {
  const idleExitTimer = setTimeout(() => void shutdown('IDLE_EXIT'), config.idleExitAfterMs);
  idleExitTimer.unref();
}
