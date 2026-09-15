import { join } from 'node:path';
import { loadConfig } from './infrastructure/config.ts';
import { prepareRuntimeTempStorage } from './infrastructure/runtime-temp.ts';

const bootstrapConfig = loadConfig();
const runtimeTempStorage = await prepareRuntimeTempStorage(bootstrapConfig.tempDir, bootstrapConfig.dataDir);
const config = { ...bootstrapConfig, tempDir: runtimeTempStorage.directory };
const [
  { installAiRuntimeCapabilitiesCache },
  { OperationsGateway },
  { applyPendingRestore },
] = await Promise.all([
  import('./ai/runtime-capabilities-cache.ts'),
  import('./operations/gateway.ts'),
  import('./operations/restore.ts'),
]);
const restore = await applyPendingRestore(config.dataDir);

let shuttingDown = false;
let gateway: InstanceType<typeof OperationsGateway>;
let uninstallAiRuntimeCapabilitiesCache: (() => void) | undefined;

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  const deadline = setTimeout(() => process.exit(1), 15_000);
  deadline.unref();
  try {
    await gateway.close();
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
  } finally {
    uninstallAiRuntimeCapabilitiesCache?.();
    uninstallAiRuntimeCapabilitiesCache = undefined;
  }
}

gateway = new OperationsGateway(config, {
  requestRestart: () => void shutdown('RESTORE_STAGED'),
  tempStorageMode: runtimeTempStorage.mode,
});
uninstallAiRuntimeCapabilitiesCache = installAiRuntimeCapabilitiesCache({
  databasePath: join(config.dataDir, 'basketra.db'),
  provider: () => {
    const settings = gateway.runtimeSettings();
    if (!settings.aiBaseUrl || !settings.aiModel) return undefined;
    return { baseUrl: new URL(settings.aiBaseUrl), model: settings.aiModel };
  },
});

process.once('SIGTERM', () => void shutdown('SIGTERM'));
process.once('SIGINT', () => void shutdown('SIGINT'));

await gateway.listen();
