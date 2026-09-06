# Receipt confirmation SQLite failure

Date: 2026-09-06
Status: blocked pending affected-database evidence

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


## Current validation

Head `a52ea909ce365b12ca4d9f08c7dd9fd838a9acc1` is green:

- Pull Request Quality `34062502074`: success.
  - Quality: success.
  - Browser E2E: success.
  - Security: success.
  - Container smoke: success.
  - linux/amd64: success.
  - linux/arm64: success.
- CodeQL Advanced `34062502095`: success.
- Publish PR visual evidence `34062502087`: success.
- Quality reports 391/391 covered tests passing and changed-code coverage at 100% for 20 changed executable lines, 1 function and 11 branches.
- The post-upgrade regression successfully confirms an ALCAMPO Store-backed receipt and preserves Store ownership on its receipt-derived price observation.

## Additional investigation

The receipt catalog projection migration was compared at the main-branch merge points that introduced it and later category work:

- `652a1a8f55cd08cdb7b30c6377ec8e8bc643272d` (PR #47)
- `58cc5058673a77a928ec2fa553e8c93aae02a25e` (PR #49)

The migration-7 receipt projection and `receipt_items_project_catalog` trigger definition are unchanged across those published main states. A stale migration-7 trigger caused by rewriting that migration after it reached main is therefore not supported by repository history and must not be treated as the root cause.

PR #53 changes schema v15 only by adding shopping-list Store references and does not modify `BasketraDatabase.importReceipt`. CI also proves receipt confirmation after the v15 upgrade. The remaining evidence points to a condition specific to the persisted database or its runtime state, not the generic v15 upgrade path.

## Required next evidence

The affected Raspberry/database must produce one of the following before a root-cause mutation is justified:

1. a confirmation failure running this branch so the sanitized event includes `sqliteErrcode` and `sqliteErrstr`; or
2. a read-only SQLite diagnostic from the affected database covering schema version, integrity/foreign-key status, capacity and receipt projection trigger presence.

No schema repair, trigger replacement or data rewrite is authorized or justified until that evidence exists.
