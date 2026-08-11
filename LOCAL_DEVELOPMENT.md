# Local development

Basketra requires SQLite FTS5 because migration 1 creates the canonical product-search virtual table. The native development path therefore depends on both a supported Node.js version and a Node build that includes FTS5.

## Native watch mode

Use the repository runtime line, preferably Node 22.23.1:

```bash
corepack enable
corepack prepare pnpm@10.15.0 --activate
pnpm install --frozen-lockfile
pnpm dev
```

`pnpm dev` runs a preflight before application startup. It rejects Node versions outside `>=22.16.0 <23` and probes FTS5 in an in-memory SQLite database. The probe does not touch Basketra data.

If the host runtime is unsupported or lacks FTS5, use the Docker path instead of changing the schema or removing full-text search.

## Runtime-parity Docker mode

```bash
cp .env.example .env
pnpm dev:docker
```

This builds and recreates the `basketra` service from `compose.yml` in the foreground, using the same pinned Node 22.23.1 Alpine runtime and Tesseract setup as the production image. Application logs remain attached to the terminal. Basketra is available at `http://127.0.0.1:3000` by default.

Stop and remove the local service/network while preserving the named data volume with:

```bash
pnpm dev:docker:down
```

For a webApi instance running on the Docker host, configure:

```dotenv
BASKETRA_AI_BASE_URL=http://host.docker.internal:3001/v1/
BASKETRA_AI_API_KEY=<managed-webapi-token>
BASKETRA_AI_MODEL=default
```

Local Compose maps `host.docker.internal` to Docker's host gateway. The mapping does not publish webApi or any additional host port; webApi must already be listening on an address reachable from Docker.

## Why Node 22.13.0 fails

Node 22.13.0 is below the repository's supported engine floor. On affected builds, the bundled `node:sqlite` runtime can reach migration 1 but reject `CREATE VIRTUAL TABLE ... USING fts5` with `no such module: fts5`. That is a host-runtime mismatch, not a Basketra database corruption or a reason to remove FTS5.
