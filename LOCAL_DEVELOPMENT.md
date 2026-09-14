# Local development

Basketra requires SQLite FTS5 because migration 1 creates the canonical product-search virtual table. The native development path therefore depends on both a supported Node.js version and a Node build that includes FTS5.

## Native watch mode

The repository pins Node 22.23.1 through Volta in `package.json`. With Volta enabled, commands executed from the repository use that canonical Node runtime instead of an older global installation.

Basketra has no environment-variable configuration surface: the bootstrap host, data directory and temporary directory are fixed, and every operator-adjustable value lives in SQLite. Provider credentials, local limits and the HTTP listen port are edited in **Ajustes → IA**, so no `.env` file, shell export or container environment block is involved.

```bash
node --version
corepack enable
corepack prepare pnpm@10.15.0 --activate
pnpm install --frozen-lockfile
pnpm dev
```

`node --version` should report `v22.23.1` when Volta is active in the repository. `pnpm dev` first runs a runtime preflight: it rejects Node versions outside `>=22.16.0 <23` and probes FTS5 in an in-memory SQLite database. The application process then starts in watch mode and listens on `http://127.0.0.1:3000` unless a different port was persisted. The probe does not touch Basketra data.

### Changing the HTTP port

The listen port is a persisted runtime setting, not an environment variable:

1. open **Ajustes → IA → Red y recursos locales**;
2. set **Puerto HTTP** and press **Guardar cambios**;
3. restart `pnpm dev`.

The new port is read from SQLite at startup. If it is already taken, Basketra logs `LISTEN_PORT_UNAVAILABLE` and keeps serving on port 3000 instead of failing to start, so a wrong value can never lock you out of the settings editor.

If the host runtime is unsupported or lacks FTS5 even with the pinned Node runtime, use the Docker path instead of changing the schema or removing full-text search.

## Runtime-parity Docker mode

```bash
pnpm dev:docker
```

This builds and recreates the `basketra` service from `compose.yml` in the foreground, using the same pinned Node 22.23.1 Alpine runtime and Tesseract setup as the production image. Application logs remain attached to the terminal. Basketra is available at `http://127.0.0.1:3000` by default.

Stop and remove the local service/network while preserving the named data volume with:

```bash
pnpm dev:docker:down
```

For a webApi instance running on the Docker host, open **Ajustes → IA** and set `http://host.docker.internal:3001/v1/` as the WebAPI URL together with its model and token. The values are stored in the `basketra-data` volume and survive container recreation.

Local Compose maps `host.docker.internal` to Docker's host gateway. The mapping does not publish webApi or any additional host port; webApi must already be listening on an address reachable from Docker.

The container always publishes `127.0.0.1:3000:3000`. To reach Basketra on another host port, change the left side of that mapping (for example `127.0.0.1:4000:3000`) and leave the container port alone; change the persisted **Puerto HTTP** only if you also publish the same container port.

## Why Node 22.13.0 fails

Node 22.13.0 is below the repository's supported engine floor. On affected builds, the bundled `node:sqlite` runtime can reach migration 1 but reject `CREATE VIRTUAL TABLE ... USING fts5` with `no such module: fts5`. That is a host-runtime mismatch, not a Basketra database corruption or a reason to remove FTS5.
