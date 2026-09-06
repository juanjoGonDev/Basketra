import { rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const COLLECT_ONLY = process.env.BASKETRA_BROWSER_COVERAGE_COLLECT_ONLY === '1';

export default class BrowserCoverageReporter {
  onBegin() {
    rmSync('.coverage/browser', { recursive: true, force: true });
  }

  onEnd(result) {
    if (result.status !== 'passed' || COLLECT_ONLY) return undefined;
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
