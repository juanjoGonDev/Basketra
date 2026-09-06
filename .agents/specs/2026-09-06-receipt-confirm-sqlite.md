# Receipt confirmation SQLite failure

Date: 2026-09-06
Status: in progress

## Request

Fix the production-only mobile receipt confirmation failure reported after PR #53 was merged. The observed request is `POST /api/v1/receipts/confirm`, which returns HTTP 500 and logs an unexpected Node SQLite error with `code=ERR_SQLITE_ERROR`. The draft remains available in the browser.

## Evidence

- `main` is `aeb3fd8e4229e099b9ca9165d948a1551f278c03` (merged PR #53).
- The failure is deterministic across repeated confirmation attempts in the user's existing database.
- Fresh-database integration coverage already proves ALCAMPO receipt confirmation, Store ownership, catalog projection and price observation projection.
- PR #53 does not modify the receipt confirmation parser or `BasketraDatabase.importReceipt` transaction.
- The current unexpected-error logger preserves `Error.code` but discards Node SQLite's numeric `errcode` and generic `errstr`. For Node SQLite, unrelated SQLite failures share `code=ERR_SQLITE_ERROR`, so the production log is insufficient to distinguish trigger constraints, locking, capacity and SQL/schema failures.
- Historical migration 7 was edited during its original PR before merge. A stale installed trigger is therefore a possible production-state risk, but it is not proven by the supplied log and must not be repaired speculatively.

## Decision

Do not mutate production schema or weaken receipt/catalog invariants without direct evidence of the failing SQLite class.

First make the existing sanitized diagnostics sufficient to identify the SQLite class while preserving the current no-payload/no-PII logging contract. Add regression coverage for the exact structured fields. Add a post-upgrade receipt confirmation regression so CI explicitly proves that the v14-to-v15 schema transition itself does not break confirmation.

After CI is green, the branch is safe to run against the affected database. The next failed confirmation, if any, must expose bounded `sqliteErrcode` and `sqliteErrstr` values without receipt content. Use that evidence for the minimal root-cause fix in this same PR.

## Scope

### In

- Sanitized SQLite diagnostic fields for unexpected HTTP errors.
- Regression tests for logging.
- Regression test for confirming a receipt after the v15 upgrade path.
- Root-cause fix once the new diagnostics identify it.

### Out

- UI redesign.
- Changes to receipt arithmetic, Store ownership, catalog matching or price semantics without evidence.
- Manual edits to the user's database.
- Destructive or remote migration.
- Merge, release or deploy.

## Risks

- The existing log intentionally omits exception messages. Exposing raw SQLite `message` could include SQL or data and is not acceptable.
- A schema repair based only on `ERR_SQLITE_ERROR` would be speculative because Node uses that same top-level code for multiple SQLite error classes.
- A post-upgrade regression passing in CI cannot prove the user's persistent database state is identical to a clean upgrade.

## Acceptance

- Unexpected Node SQLite errors include only bounded numeric `sqliteErrcode` and bounded generic `sqliteErrstr`, while preserving the incident ID and existing fields.
- Non-SQLite errors do not gain those fields.
- Tests reject oversized/non-safe diagnostic values.
- An integration test upgrades a representative pre-v15 database and successfully confirms a Store-backed receipt afterward.
- No receipt text, product names, SQL statements, file paths or other payload data are added to logs.
- `pnpm quality` and required GitHub CI are green for the final head.
- The final root-cause change is covered by a regression test before the PR is considered complete.
