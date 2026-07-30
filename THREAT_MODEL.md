# Threat model

## Assets

Receipt images and text, shopping history, product preferences, provider credentials, backups, generated storage keys, and private-network access.

## Trust boundaries

1. User browser to Basketra through loopback, VPN, SSH tunnel, reviewed LAN-only access, or authenticated private reverse proxy.
2. Basketra to the mounted data volume.
3. Basketra to an explicitly configured AI or offer provider.
4. CI processing untrusted pull-request code.
5. Raspberry Docker daemon and registry credentials used for private GHCR delivery.

## Principal threats and mitigations

- **Public exposure:** loopback application bind and loopback Docker publishing by default; public deployment is unsupported.
- **Unauthorized private-network access:** network reachability grants full application access, so the operator must restrict VPN membership, firewall routes, SSH access, or reverse-proxy authentication.
- **Path traversal:** generated storage keys, strict preview-key grammar, and resolved-path containment checks.
- **Receipt leakage through previews:** same-origin image endpoint, image-only response, `nosniff`, and `private, no-store` cache policy.
- **Receipt leakage through offline cache:** service worker excludes every `/api/` request.
- **Malicious uploads:** body limits, accepted MIME allowlist, client advisory checks, server magic-byte verification, and no execution.
- **SSRF:** provider base URL is environment-only and validated; no per-request provider URL.
- **Secret leakage:** no credential response, no environment dumps, redacted operational logs, and no application token in browser storage.
- **Financial corruption:** integer money, rational quantities, independent arithmetic validation, immutable observations, and transactional receipt confirmation.
- **Shopping-list races:** bounded SQLite transactions, exhaustive reorder payloads, foreign keys, and contiguous position normalization after deletion.
- **AI hallucination:** evidence required, local validation, bounded retries, and no AI authority over arithmetic or optimization.
- **Resource exhaustion:** body and persistent-storage limits, bounded retailer enumeration, no queues or resident workers, and container resource limits.
- **Untrusted CI code:** read-only default permissions, immutable action references, no privileged pull-request event, and publication restricted to verified pushes to `main`.

## Residual risks

A compromised trusted browser or any actor with private-network reachability can read and modify Basketra data. A malicious configured provider can retain submitted content. Removing a capture from a draft does not delete the deduplicated underlying file. Public or multi-user deployment requires identities, sessions, authorization, rate limiting, TLS termination, CSRF protection, and a separate security review.
