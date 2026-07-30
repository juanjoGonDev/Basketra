# Security

## Supported deployment

Basketra is intended for one private installation accessed through a trusted VPN, SSH tunnel, reviewed LAN-only route, or authenticated private reverse proxy. The application has no internal token or login screen. The default bind address is `127.0.0.1`, and Docker publishes the service only on host loopback.

Direct public internet exposure is unsupported. Anyone who can reach the HTTP service can access lists, receipts, diagnostics, backups, and administrative API operations.

## Controls

- loopback bind by default and explicit private-network deployment contract;
- minimal `/health` and `/readiness` probe state;
- same-origin static frontend and API;
- CSP, frame denial, MIME sniffing prevention, referrer, and permission policies;
- bounded JSON body size;
- upload MIME allowlist, magic-byte validation, SHA-256 hashing, generated storage keys, and traversal prevention;
- image previews restricted to validated generated keys and returned with `private, no-store` cache policy;
- service worker excludes every `/api/` request, including receipt previews;
- provider URL set only by administrative environment configuration;
- no provider key returned to the browser;
- no receipt text in default logs;
- non-root read-only container, dropped capabilities, PID/memory/CPU/log limits;
- bounded shutdown and temporary-file cleanup;
- exact Node.js and Alpine runtime base versions;
- npm, Corepack, pnpm, and Yarn removed from the final image after compilation;
- pull-request image scanning fails on fixed HIGH or CRITICAL vulnerabilities;
- AMD64 and ARM64 builds generate SBOM and provenance metadata.

## Operator requirements

- keep `BASKETRA_BIND_ADDRESS=127.0.0.1` unless a LAN-only bind and firewall have been reviewed;
- terminate remote access at a VPN, SSH tunnel, or authenticated TLS reverse proxy;
- do not rely on a non-standard port or browser storage for access control;
- do not expose port 3000 directly to the internet;
- treat every device and user with network reachability as fully authorized.

## Reporting

Do not open a public issue containing a secret, private receipt, provider URL, backup name, storage key, or personal data. Contact the repository owner privately.

## Known limitations

Basketra does not provide user identities, sessions, CSRF-safe cookies, rate limiting, or authorization roles. Public or multi-user deployment requires a separate security design and is outside the supported product scope.
