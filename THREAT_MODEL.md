# Threat model

## Assets

Receipt images/text, shopping history, product preferences, provider credentials, backups, and local network access.

## Trust boundaries

1. Browser to Basketra over VPN/private network.
2. Basketra to mounted data volume.
3. Basketra to an explicitly configured AI or offer provider.
4. CI processing untrusted pull-request code.

## Principal threats and mitigations

- **Public exposure:** loopback bind and loopback Docker publishing by default.
- **Unauthorized private-network access:** optional bearer token and protected diagnostics/data endpoints.
- **Path traversal:** generated storage keys and resolved-path containment checks.
- **Malicious uploads:** body limits, accepted MIME allowlist, magic-byte verification, no execution.
- **SSRF:** provider base URL is environment-only and validated; no per-request URL.
- **Secret leakage:** no credential response, no env dumps, redacted operational logs.
- **Receipt leakage through offline cache:** service worker excludes API and file paths.
- **Financial corruption:** integer money, rational quantities, independent arithmetic validation, immutable observations.
- **AI hallucination:** evidence required, local validation, bounded retries, no AI authority over arithmetic or optimization.
- **Resource exhaustion:** body limits, bounded retailer enumeration, no queues/workers, container limits.

## Residual risks

A compromised trusted browser can read local data and a locally stored bearer token. A malicious configured provider can retain submitted content. Public deployment requires stronger authentication, TLS termination, CSRF-safe cookies, and additional rate limiting.
