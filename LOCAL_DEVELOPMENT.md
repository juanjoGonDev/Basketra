# Local development

Basketra requires SQLite FTS5 because migration 1 creates the canonical product-search virtual table. The native development path therefore depends on both a supported Node.js version and a Node build that includes FTS5.

## Native watch mode

The repository pins Node 22.23.1 through Volta in `package.json`. With Volta enabled, commands executed from the repository use that canonical Node runtime instead of an older global installation.

Create a local `.env` when provider or runtime overrides are needed. `pnpm dev` loads that file through Node's native `--env-file-if-exists=.env` support, so the same command works from Windows `cmd.exe`, PowerShell and Unix shells without shell-specific environment syntax or an additional dotenv dependency. Existing process environment variables keep precedence over values from `.env`.

```bash
node --version
corepack enable
corepack prepare pnpm@10.15.0 --activate
pnpm install --frozen-lockfile
pnpm dev
```

`node --version` should report `v22.23.1` when Volta is active in the repository. `pnpm dev` first runs a runtime preflight: it rejects Node versions outside `>=22.16.0 <23` and probes FTS5 in an in-memory SQLite database. The application process then starts in watch mode with `.env` loaded when the file exists. The probe does not touch Basketra data.

Restart `pnpm dev` after changing `.env`; the application source watcher does not treat the environment file as application source.

If the host runtime is unsupported or lacks FTS5 even with the pinned Node runtime, use the Docker path instead of changing the schema or removing full-text search.

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
