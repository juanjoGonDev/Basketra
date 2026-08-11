import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

const shouldSkip =
  process.env['SKIP_GIT_HOOKS'] === 'true' ||
  process.env['CI'] === 'true' ||
  process.env['NODE_ENV'] === 'production' ||
  !existsSync('.git');

if (shouldSkip) process.exit(0);

const shell = process.platform === 'win32';
const gitCheck = spawnSync('git', ['--version'], {
  stdio: 'ignore',
  shell,
});

if (gitCheck.status !== 0) process.exit(0);

const lefthook = spawnSync('lefthook', ['install'], {
  stdio: 'inherit',
  shell,
});

process.exit(lefthook.status ?? 1);
