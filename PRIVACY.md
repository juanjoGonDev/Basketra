# Privacy

Basketra is designed for a single private installation. Receipt captures, extracted text, corrections, product mappings, shopping lists, and price history remain on the mounted local filesystem and SQLite database unless the operator explicitly configures an external AI or offer provider.

The service worker caches only the application shell. It excludes every `/api/` request, including stored image previews, so receipt content and private API responses are not persisted in the service-worker cache. Image previews use same-origin generated storage keys and `Cache-Control: private, no-store`.

The browser stores only interface state required to resume work: active list identifier, unsubmitted list-item draft, capture metadata, and optional AI mode. It does not store an application access token or provider credential.

External AI calls may disclose submitted operation content to the configured provider. Use a provider you trust, prefer local or VPN endpoints, and review its retention policy. Basketra does not log complete receipt content or AI responses by default.

Original capture retention is persistent. Removing a capture from a draft does not delete the underlying evidence because it may be deduplicated or referenced by a confirmed receipt. A future garbage-collection policy must prove that a file is unreferenced before deletion.

Network reachability is authorization in the supported deployment. Restrict access using loopback, VPN, firewall, SSH tunnelling, or an authenticated private reverse proxy.
