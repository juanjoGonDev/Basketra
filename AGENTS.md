# Repository agent instructions

Read `spec.md` and `.agents/specs/` before changing behavior.

## Deployment trust model

- Basketra is a single-user, self-hosted local application operated by the repository owner and reachable only through the owner's trusted LAN/VPN deployment.
- Do not invent public-Internet, anonymous-client, hostile multi-tenant, SaaS, or arbitrary-user threat assumptions as product requirements unless the user explicitly changes this deployment model.
- Security decisions must match the real deployment. Prioritize secrets, data integrity, service-to-service authentication, accidental exposure, safe persistence/recovery, and the explicitly configured LAN/VPN boundary.
- Do not preserve or add Basketra-specific functional limits, rate limits, upload policies, or rejection paths solely to defend against hypothetical hostile public clients. Operational resource guards require concrete local-runtime evidence and must not override the canonical product/provider contract.
- WebAPI is the single source of truth for AI/provider capabilities and attachment limits. Basketra must not define a competing AI attachment limit. Prefer a live WebAPI capability read; when availability requires a fallback, persist and use only the last validated WebAPI capability snapshot, clearly treating it as stale provider data rather than Basketra policy.
- Operator-adjustable runtime settings should be persisted and configurable through the application when practical. Do not make environment variables the canonical mutable settings owner when an existing runtime-settings boundary can own the value dynamically.

- Use English for code, tests, commits, PRs, schemas, configuration, and documentation. `spec.md` remains Spanish by product requirement.
- Preserve the dependency-free runtime unless measured evidence proves a package is necessary.
- Keep one Node.js process, SQLite, bounded work, no polling, no resident OCR/browser worker, and no external database.
- Store money as integer minor units and quantities as exact rational values.
- Preserve evidence; never overwrite price observations or original receipt extraction data.
- Never expose secrets, receipt content, filesystem paths, or provider credentials.
- Add a regression test for every bug when practical.
- Run `pnpm quality` before delivery. Run Docker checks when a Docker daemon is available.
- Do not merge, release, deploy, change protected branches, or perform destructive data operations without explicit authorization.
