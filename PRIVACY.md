# Privacy

Basketra is designed for a single private installation. Receipt captures, extracted text, corrections, product mappings, lists, and price history remain on the mounted local filesystem and SQLite database unless the user explicitly configures an external AI or offer provider.

The service worker caches only the application shell. It excludes `/api/` and `/files/`, so receipt content and private API responses are not persisted in the browser cache.

External AI calls may disclose the supplied operation content to the configured provider. Use a provider you trust, prefer local/VPN endpoints, and review its retention policy. Basketra does not log complete receipt content or AI responses by default.

Original capture retention is currently persistent. Deletion-after-validation is a planned policy control and must not be assumed active.
