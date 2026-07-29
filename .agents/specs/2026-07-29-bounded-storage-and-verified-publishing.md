# Bounded storage and verified image publishing

## Status

Implementation complete locally; pull-request CI pending.

## Request

Audit Basketra for residues and unbounded RAM, database, backup, temporary-file, log, image, and registry growth. Apply explicit limits, add every practical CI regression test, update the existing feature branch with current `main`, and implement both previously recommended delivery safeguards: published-image verification before `stable` promotion and true branch synchronization.

## Evidence

- Migration backups were full database copies with no count or byte retention policy. Repeated failed startup migrations could create one additional valid copy per attempt.
- Manual API backups had no retention policy.
- Receipt evidence was individually size-limited and deduplicated, but total persistent evidence size was unbounded.
- SQLite used WAL but had no explicit maximum database page count, page-cache budget, or journal-size target.
- The AI provider buffered provider responses without a byte ceiling.
- The resource script reported measurements but did not fail when memory, storage growth, CPU, startup, or shutdown exceeded a budget.
- The existing publication job assigned the immutable SHA and `stable` tags in one build-push operation, so the exact registry artifact was not pulled and exercised before promotion.
- Immutable SHA tags would accumulate in GHCR without a release-retention policy.
- The feature branch was two commits behind `main`, including corrected repository automation and the manual-major Dependabot policy.

## Decision

### Persistent data

- Cap the primary SQLite database at 512 MiB with `PRAGMA max_page_count`.
- Cap the SQLite page cache at 8 MiB and set a 16 MiB WAL journal target with bounded auto-checkpointing.
- Retain automatic migration backups by both count and total bytes: newest 3, at most 768 MiB combined.
- Retain manual API backups by both count and total bytes: newest 5, at most 768 MiB combined.
- Create backups through unique temporary files and atomic rename, deleting partial files in `finally` paths.
- Cap deduplicated receipt evidence at 512 MiB and remove stale/failed upload temporaries.
- Fail explicitly when an existing or requested data set cannot fit a configured hard budget.

### Runtime

- Limit V8 old space to 128 MiB inside a 192 MiB application container.
- Set memory+swap equal to the memory limit, preserving native-runtime headroom while preventing swap escape.
- Preserve CPU, PID, tmpfs, read-only filesystem, log rotation, health, and graceful-shutdown limits.
- Limit AI response bodies to 1 MiB and cancel streaming immediately after the ceiling is crossed.
- Convert resource measurement from informational output into assertions over absolute usage and repeated steady-state growth.

### Delivery

- Publish only the immutable full-SHA candidate initially.
- Verify the registry manifest contains exactly the runnable AMD64 and ARM64 platforms.
- Pull and start the exact published digest under production limits, verify its revision label, readiness, and graceful shutdown.
- Promote the verified digest to `stable` without rebuilding and compare the resulting manifest byte-for-byte.
- Delete an unpromoted candidate after a failed verification path.
- Keep only the newest ten SHA-tagged GHCR releases through a unit-tested retention selector; do not target untagged manifests directly.
- Keep Watchtower local-image cleanup enabled but explicitly forbid volume deletion.
- Integrate current `main` as a real second-parent merge commit while preserving the existing PR and feature branch.

## Acceptance criteria

- Five repeated failed migration startups with retention count two leave exactly two valid backups and no temporary files.
- Manual backup retention removes superseded copies and every remaining backup passes integrity validation.
- A backup that cannot fit fails before leaving a file.
- SQLite reports page-count, cache, and journal ceilings at or below configured values.
- Persistent receipt evidence rejects a unique file that would cross the total byte ceiling, while deduplication remains valid.
- Oversized AI responses are rejected from both declared length and streaming overflow paths.
- Resource CI fails on excessive RSS, heap, steady-state growth, idempotent storage growth, idle CPU, startup, shutdown, or missing hibernation.
- Compose validation proves heap, memory+swap, PID, CPU, tmpfs, log, and volume-cleanup controls.
- Pull-request CI still builds AMD64 and ARM64 images and runs the hardened local smoke test.
- Main publication cannot move `stable` until the exact GHCR digest passes manifest and runtime verification.
- GHCR cleanup never deletes the current/stable release and retains the configured newest SHA releases.
- The existing PR remains open and unmerged.

## Validation plan

- Strict TypeScript compilation.
- Existing unit, integration, end-to-end, coverage, and browser suites.
- New storage, backup-retention, AI response, and GHCR retention unit/integration tests.
- Executable resource and growth budget.
- YAML parsing and both Compose configurations.
- Repository security/policy scan including publication ordering and bounded-resource contracts.
- Trivy container scan.
- AMD64 and ARM64 Buildx builds with SBOM and provenance.
- Hardened local container readiness, cgroup inspection, and graceful stop.
- Main-only registry validation remains intentionally unexercised on the pull-request event; its pure retention logic and workflow contract are tested in PR CI.

## Risks

- Reaching a hard database or file budget rejects new writes; operators must export/remove data or deliberately change reviewed code limits rather than silently filling the disk.
- Local backup retention is not disaster recovery. Important backups must be copied off-volume before pruning.
- GitHub package deletion through `GITHUB_TOKEN` requires the repository to retain admin access to the package. A retention failure fails the publication workflow and must be investigated.
- Physical ARM64 runtime, private pull authentication, disk latency, thermal behavior, and the existing global Watchtower interaction require host validation after an approved merge.

## Rollback

Revert the integration commit. Existing retained backups and immutable package versions remain usable. Do not remove the `basketra-data` volume. If a newer schema is incompatible with the reverted application, restore the matching validated pre-migration backup offline.

## Delivery

Use existing branch `agent/feat-basketra-foundation` and pull request `#1`. Do not merge, deploy, alter the Raspberry host, or create real secrets.
