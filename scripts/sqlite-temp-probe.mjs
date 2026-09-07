import { DatabaseSync } from 'node:sqlite';

const EXPECTED_TEMP_DIR = '/tmp/basketra';
const REQUIRED_TEMP_ENV = ['SQLITE_TMPDIR', 'TMPDIR'];

for (const name of REQUIRED_TEMP_ENV) {
  if (process.env[name] !== EXPECTED_TEMP_DIR) {
    throw new Error(`${name} must target the writable Basketra tmpfs`);
  }
}

const expectedBytes = 2 * 1024 * 1024;
const database = new DatabaseSync(':memory:');
try {
  database.exec(
    'PRAGMA temp_store = FILE; PRAGMA temp.cache_size = 1; CREATE TEMP TABLE temp_probe(value BLOB);',
  );
  database.prepare('INSERT INTO temp_probe(value) VALUES (zeroblob(?))').run(expectedBytes);
  const row = database.prepare('SELECT length(value) AS bytes FROM temp_probe').get();
  if (row?.bytes !== expectedBytes) {
    throw new Error('SQLite temporary-file probe returned unexpected data');
  }
} finally {
  database.close();
}

console.log('SQLite temp-file probe passed.');
