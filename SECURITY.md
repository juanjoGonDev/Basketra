# Security

## Supported deployment

Basketra is intended for one private installation accessed through a trusted VPN, SSH tunnel, reviewed LAN-only route, or authenticated private reverse proxy. The application has no internal token or login screen. The default bind address is `127.0.0.1`, and Docker publishes the service only on host loopback.

Direct public internet exposure is unsupported. Anyone who can reach the HTTP service can access lists, receipts, diagnostics, application logs, backups, and administrative restore operations.

## Controls

- loopback bind by default and explicit private-network deployment contract;
- minimal `/health` and `/readiness` probe state;
- same-origin static frontend and API;
- CSP, frame denial, MIME sniffing prevention, referrer, and permission policies;
- bounded JSON body size and independently bounded streamed SQLite imports;
- upload MIME allowlist, magic-byte validation, SHA-256 hashing, generated storage keys, and traversal prevention;
- image previews restricted to validated generated keys and returned with `private, no-store` cache policy;
- service worker excludes every `/api/` request, including receipt previews, backups, logs, and diagnostics;
- provider URL set only by administrative environment configuration;
- explicit Docker-loopback diagnosis and host-gateway mapping for providers on the Raspberry host;
- no provider key returned to the browser; only an optional last-four mask;
- bounded NDJSON application logs with a closed metadata schema and no receipt content;
- client logs treated as untrusted with schema validation, field caps, batch caps, and rate limiting;
- backup names generated or strictly validated and resolved only beneath fixed directories;
- backup downloads use attachment and private no-store headers;
- imported databases stream to an owner-only staging file, enforce the 512 MiB database ceiling, hash incrementally, and validate SQLite integrity/schema;
- restore requires an exact confirmation phrase, a validated pre-restore backup, an atomic marker, startup revalidation, and inactive-database replacement;
- failed restore markers are moved aside to prevent destructive restart loops;
- non-root read-only container, dropped capabilities, PID/memory/CPU/Docker-log limits;
- bounded shutdown and temporary-file cleanup;
- exact Node.js and Alpine runtime base versions;
- npm, Corepack, pnpm, and Yarn removed from the final image after compilation;
- pull-request image scanning fails on fixed HIGH or CRITICAL vulnerabilities;
- AMD64 and ARM64 builds generate SBOM and provenance metadata;
- trusted release publication verifies the exact digest/runtime version before promoting `stable`, a numeric tag, or a GitHub release.

## Application log boundary

The application log endpoint exposes only structured operational metadata:

- server-generated timestamp;
- `source` (`server` or `client`);
- level and stable event name;
- request ID;
- HTTP method and path without query;
- status, bounded duration, and stable error code.

It does not accept or return receipt text, uploaded filenames, request bodies, headers, cookies, credentials, provider responses, arbitrary client messages, filesystem paths, database bytes, or environment values. Docker process logs remain separate and must also be handled as private operational data.

## Operator requirements

- keep `BASKETRA_BIND_ADDRESS=127.0.0.1` unless a LAN-only bind and firewall have been reviewed;
- terminate remote access at a VPN, SSH tunnel, or authenticated TLS reverse proxy;
- do not rely on a non-standard port or browser storage for access control;
- do not expose the Basketra or optional AI-provider ports directly to the internet;
- bind a host AI provider only to an interface reachable by the Docker bridge and restrict it with firewall rules;
- use one environment variable per line and recreate the container after changing `.env`;
- rotate any credential exposed in chat, screenshots, shell history, or logs;
- export important backups and receipt evidence to separately managed storage;
- treat every device and user with network reachability as fully authorized.

## Reporting

Do not open a public issue containing a secret, private receipt, provider URL, backup/import name, storage key, request identifier tied to private activity, log extract, or personal data. Contact the repository owner privately.

## Known limitations

Basketra does not provide user identities, sessions, CSRF-safe cookies, authorization roles, or a public multi-user threat boundary. The client log ingestion rate limit is an abuse/volume control inside the trusted perimeter, not authentication. Public or multi-user deployment requires a separate security design and is outside the supported product scope.
