import { loadConfig } from './infrastructure/config.ts';
import { BasketraServer } from './api/server.ts';

const config = loadConfig();
const server = new BasketraServer(config);
let shuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  const deadline = setTimeout(() => process.exit(1), 15_000);
  deadline.unref();
  try {
    await server.close();
    clearTimeout(deadline);
    process.exitCode = 0;
  } catch (error) {
    console.error(JSON.stringify({ level: 'error', event: 'shutdown_failed', signal, message: error instanceof Error ? error.message : 'unknown' }));
    process.exitCode = 1;
  }
}

process.once('SIGTERM', () => void shutdown('SIGTERM'));
process.once('SIGINT', () => void shutdown('SIGINT'));

await server.listen();
const address = server.address();
console.log(JSON.stringify({ level: 'info', event: 'server_started', host: address.host, port: address.port }));

if (config.idleExitAfterMs > 0) {
  const idleExitTimer = setTimeout(() => void shutdown('IDLE_EXIT'), config.idleExitAfterMs);
  idleExitTimer.unref();
}
