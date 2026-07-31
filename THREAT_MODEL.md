# Threat model

## Assets

Receipt images and text, shopping history, product preferences, provider credentials, application logs, backups/imports, restore markers, release metadata, generated storage keys, and private-network access.

## Trust boundaries

1. User browser to Basketra through loopback, VPN, SSH tunnel, reviewed LAN-only access, or authenticated private reverse proxy.
2. Public operations gateway to the in-process application server on ephemeral loopback.
3. Basketra to the mounted data volume containing SQLite, receipt evidence, logs, backups, imports, and restore markers.
4. Basketra to an explicitly configured AI or offer provider.
5. Browser-originated log events crossing into the persistent server log stream.
6. CI processing untrusted pull-request code.
7. Trusted main publication using repository and package write permissions.
8. Raspberry Docker daemon and registry credentials used for private GHCR delivery.

## Principal threats and mitigations

- **Public exposure:** loopback application bind and loopback Docker publishing by default; public deployment is unsupported.
- **Unauthorized private-network access:** network reachability grants full application access, so the operator must restrict VPN membership, firewall routes, SSH access, or reverse-proxy authentication.
- **Gateway bypass:** the application server binds only to ephemeral process-local loopback; only the operations gateway owns the configured socket.
- **Path traversal:** generated storage keys, strict preview/backup-name grammars, fixed directories, query decoding guards, and resolved-path containment.
- **Receipt leakage through previews:** same-origin image endpoint, image-only response, `nosniff`, and `private, no-store` cache policy.
- **Private data in offline cache:** service worker excludes every `/api/` request, including logs, backups, diagnostics, and previews.
- **Malicious receipt uploads:** body limits, accepted MIME allowlist, client advisory checks, server magic-byte verification, and no execution.
- **Malicious backup imports:** SQLite content-type allowlist, 512 MiB streamed limit, owner-only staging file, partial cleanup, SHA-256, integrity/schema validation, and generated final name.
- **Destructive or confused restore:** exact confirmation phrase, validated candidate, mandatory pre-restore backup, atomic marker, graceful shutdown, startup revalidation, temporary replacement validation, atomic rename, and failed-marker quarantine.
- **Restore restart loop:** a failed pending marker is moved aside before normal startup; it is never retried indefinitely.
- **Incomplete recovery:** database restore deliberately does not invent or overwrite receipt files; runbooks require compatible `/data/files` preservation.
- **SSRF:** provider base URL is environment-only and validated; no per-request provider URL. Docker loopback is rejected diagnostically for host providers.
- **Provider exposure:** the operator must bind a host provider only to Docker/private interfaces and firewall it; `host.docker.internal` is routing, not authentication.
- **Secret leakage:** no full credential response, no environment dumps, last-four mask only, redacted application logs, and no application token in browser storage.
- **Client log injection:** closed event vocabulary prefix, allowlisted fields, server timestamp, field-size caps, path without query, batch caps, rate limit, encoded-event limit, and no arbitrary message field.
- **Log storage exhaustion:** active-file line/byte limits, bounded archives, oldest-first deletion, and no per-success high-volume request logging.
- **Financial corruption:** integer money, rational quantities, independent arithmetic validation, immutable observations, and transactional receipt confirmation.
- **Shopping-list races:** bounded SQLite transactions, exhaustive reorder payloads, foreign keys, and contiguous position normalization after deletion.
- **AI hallucination:** evidence required, local validation, bounded retries, and no AI authority over arithmetic or optimization.
- **Resource exhaustion:** body and persistent-storage limits, streamed imports, bounded retailer enumeration, no unbounded queues or resident workers, adaptive non-overlapping heartbeat, and container resource limits.
- **Stale connectivity state:** heartbeat timeout, generation invalidation, fast recovery cadence, hidden-tab pause, and refresh after route recovery.
- **Release/tag substitution:** immutable SHA candidate, registry digest verification, exact-digest runtime smoke, version/revision check, promotion without rebuild, numeric/stable manifest verification, and release creation only after all gates.
- **Version consumption on rerun:** release resolution reuses a version already targeting the same immutable commit.
- **Untrusted CI code:** read-only default permissions, immutable action references, no `pull_request_target`, no publication on pull requests, and write permissions scoped to the trusted main publication job.

## Residual risks

A compromised trusted browser or any actor with private-network reachability can read and modify Basketra data, view application logs, download backups, and stage a restore. A malicious configured provider can retain submitted content. Docker host compromise bypasses the application boundary. Exported backups and evidence copies are outside Basketra retention controls. Removing a capture from a draft does not delete the deduplicated underlying file. Public or multi-user deployment requires identities, sessions, authorization, stronger rate limiting, TLS termination, CSRF protection, audit identity, and a separate security review.
