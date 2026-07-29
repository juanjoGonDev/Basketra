# Security

## Supported deployment

Basketra is intended for private VPN/LAN access. The default bind address is `127.0.0.1`. Docker publishes the service only on host loopback.

## Controls

- optional bearer token for sensitive endpoints;
- public `/health` and `/readiness` expose only minimal probe state;
- same-origin static frontend/API;
- CSP, frame denial, MIME sniffing prevention, referrer and permission policies;
- bounded JSON body size;
- upload MIME and magic-byte validation, SHA-256 hashing, generated storage keys, and traversal prevention;
- provider URL set only by administrative environment configuration;
- no provider key returned to the browser;
- no receipt text in default logs;
- non-root read-only container, dropped capabilities, PID/memory/CPU/log limits;
- bounded shutdown and temporary-file cleanup;
- exact Node.js and Alpine runtime base versions;
- npm, Corepack, pnpm and Yarn removed from the final image after compilation;
- pull-request image scanning fails on fixed HIGH or CRITICAL vulnerabilities;
- AMD64 and ARM64 builds generate SBOM and provenance metadata.

## Reporting

Do not open a public issue containing a secret, private receipt, provider URL, or personal data. Contact the repository owner privately.

## Known limitations

Bearer-token storage in the current PWA is local browser storage and is appropriate only for a trusted private device over VPN. A hardened cookie-based local authentication mode is future work before public exposure.
