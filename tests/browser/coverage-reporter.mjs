import { rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

export default class BrowserCoverageReporter {
  onBegin() {
    rmSync('.coverage/browser', { recursive: true, force: true });
  }

  onEnd(result) {
    if (result.status !== 'passed') return undefined;
    const coverage = spawnSync('node', ['scripts/check-browser-diff-coverage.mjs'], {
      encoding: 'utf8',
      stdio: 'pipe',
      shell: false,
    });
    if (coverage.stdout) process.stdout.write(coverage.stdout);
    if (coverage.stderr) process.stderr.write(coverage.stderr);
    if (coverage.status === 0) return undefined;
    return { status: 'failed' };
  }
}
