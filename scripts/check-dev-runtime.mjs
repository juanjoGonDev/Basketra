const SUPPORTED_MAJOR = 22;
const MINIMUM_MINOR = 16;
const RECOMMENDED_NODE_VERSION = '22.23.1';

const [major = 0, minor = 0] = process.versions.node.split('.').map(Number);

if (major !== SUPPORTED_MAJOR || minor < MINIMUM_MINOR) {
  console.error(
    `Basketra local development requires Node >=22.16.0 <23. Current: ${process.version}. ` +
      `Install Node ${RECOMMENDED_NODE_VERSION} or run \`pnpm dev:docker\` for the pinned runtime.`,
  );
  process.exit(1);
}

let database;
try {
  const { DatabaseSync } = await import('node:sqlite');
  database = new DatabaseSync(':memory:');
  database.exec('CREATE VIRTUAL TABLE basketra_fts5_probe USING fts5(value);');
  database.exec('DROP TABLE basketra_fts5_probe;');
} catch {
  console.error(
    `This Node ${process.version} build does not provide the SQLite FTS5 capability required by Basketra. ` +
      `Use the official Node ${RECOMMENDED_NODE_VERSION} runtime or run \`pnpm dev:docker\`.`,
  );
  process.exitCode = 1;
} finally {
  database?.close();
}
