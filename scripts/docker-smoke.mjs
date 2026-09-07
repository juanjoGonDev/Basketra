import { spawnSync } from 'node:child_process';

const version = spawnSync('docker', ['--version'], { encoding: 'utf8' });
if (version.status !== 0) {
  console.error('Docker is required for docker:smoke.');
  process.exit(1);
}

const build = spawnSync('docker', ['build', '-t', 'basketra:smoke', '.'], { stdio: 'inherit' });
if (build.status !== 0) process.exit(build.status ?? 1);

const sqliteTempProbe = `
  import { DatabaseSync } from 'node:sqlite';

  if (process.env.SQLITE_TMPDIR !== '/tmp/basketra') {
    throw new Error('SQLITE_TMPDIR must target the writable Basketra tmpfs');
  }
  if (process.env.TMPDIR !== '/tmp/basketra') {
    throw new Error('TMPDIR must target the writable Basketra tmpfs');
  }

  const database = new DatabaseSync(':memory:');
  try {
    database.exec(
      "PRAGMA temp_store = FILE; CREATE TEMP TABLE temp_probe(value TEXT); INSERT INTO temp_probe(value) VALUES ('ok');",
    );
    const row = database.prepare('SELECT value FROM temp_probe').get();
    if (row?.value !== 'ok') throw new Error('SQLite temporary-file probe returned unexpected data');
  } finally {
    database.close();
  }
`;

const run = spawnSync(
  'docker',
  [
    'run',
    '--rm',
    '--read-only',
    '--tmpfs',
    '/tmp/basketra:rw,noexec,nosuid,size=32m',
    'basketra:smoke',
    'node',
    '--input-type=module',
    '-e',
    sqliteTempProbe,
  ],
  { stdio: 'inherit' },
);
if (run.status !== 0) process.exit(run.status ?? 1);

console.log('Docker smoke passed.');
