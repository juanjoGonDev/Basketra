# Receipt confirmation SQLite failure

Date: 2026-09-06
Status: implementation complete; final PR CI and affected-device verification remain

## Request

Fix the mobile production failure on `POST /api/v1/receipts/confirm` after PR #53. The request returned HTTP 500 and the server exposed only `ERR_SQLITE_ERROR`; the browser preserved the receipt draft.

## Evidence

- Baseline `main` for this task is `aeb3fd8e4229e099b9ca9165d948a1551f278c03`, the PR #53 merge.
- The supplied production attempts repeatedly failed during receipt confirmation with `ERR_SQLITE_ERROR`.
- PR #53 adds schema-v15 Store references to shopping lists but does not modify `BasketraDatabase.importReceipt()`.
- Existing fresh-database and post-upgrade tests prove ALCAMPO receipt confirmation, Store ownership, catalog projection and receipt-derived price Store projection.
- The migration-7 receipt projection and `receipt_items_project_catalog` trigger are unchanged between the published PR #47 merge state `652a1a8f55cd08cdb7b30c6377ec8e8bc643272d` and the later PR #49 main state `58cc5058673a77a928ec2fa553e8c93aae02a25e`. Repository history therefore does not support repairing that trigger speculatively.
- The original unexpected-error logger retained Node's top-level `ERR_SQLITE_ERROR` but not the bounded numeric `errcode` or generic `errstr`.

## Proven root cause

`BasketraDatabase.importReceipt()` opened an explicit SQLite transaction and unconditionally executed `ROLLBACK` in its catch block.

SQLite can end a transaction itself for rollback-class failures. A deterministic regression installs a test-only trigger that executes `RAISE(ROLLBACK, 'FORCED_RECEIPT_ROLLBACK')` while receipt import is active.

On the unpatched implementation:

- head: `fc2cb47166699680b248fdd5ac591ce58772c3e4`
- Quality run: `34065932143`
- expected original failure: `FORCED_RECEIPT_ROLLBACK`
- actual propagated failure: `cannot rollback - no transaction is active`

The cleanup rollback therefore replaced the original SQLite exception. This directly explains why a confirmation failure can lose the useful SQLite class before the HTTP error logger sees it.

The pre-fix production log cannot establish which underlying SQLite condition triggered the automatic rollback because that exception may already have been masked.

## Decision

Fix the transaction owner, not the schema:

1. issue cleanup `ROLLBACK` only while `DatabaseSync.isTransaction` is true;
2. rethrow the original failure unchanged;
3. model `DatabaseSync.isTransaction` in the project-local Node type shim for the pinned Node 22 runtime;
4. expose only bounded `sqliteErrcode` and `sqliteErrstr` for unexpected Node SQLite errors;
5. retain the existing no-message/no-payload logging contract;
6. keep the post-v15 Store-backed receipt confirmation regression.

Do not recreate triggers, rewrite applied migrations, or mutate persistent receipt/catalog data without evidence of a separate database-state defect.

## Scope

### In

- Receipt-import transaction cleanup.
- Safe SQLite error classification fields.
- Regression proving the original SQLite error survives an automatic rollback.
- Post-v15 Store-backed receipt confirmation regression.
- Unit coverage for diagnostic inclusion and redaction.

### Out

- Receipt UI redesign.
- Changes to receipt arithmetic or catalog matching.
- Manual edits to the Raspberry database.
- Trigger replacement or data repair without evidence.
- Merge, release or deploy.

## Security and data handling

- Do not log raw exception messages.
- Do not log SQL statements.
- Do not log receipt text, product names, Store values, paths or request payloads.
- `sqliteErrcode` must be a bounded safe integer.
- `sqliteErrstr` must remain a bounded generic SQLite diagnostic string.
- Non-SQLite errors must not gain SQLite-specific fields.

## Acceptance

- A SQLite failure that already ended the receipt transaction is rethrown unchanged.
- The rollback-masking regression fails before the fix and passes after it.
- The connection remains consistent with no partial receipt after the forced rollback.
- Unexpected Node SQLite errors expose only bounded `sqliteErrcode` and `sqliteErrstr`.
- Invalid, oversized and non-SQLite diagnostic values are omitted.
- A representative pre-v15 database upgrades and then confirms a Store-backed ALCAMPO receipt.
- Receipt and receipt-derived price observation keep the same Store.
- Changed executable code remains fully covered.
- Required GitHub CI is green on the final PR head.
- No unrelated production files are changed.

## Validation evidence

The code-bearing head `cdab531fded30bee30cac9709138c840dd869744` passed Quality after the fix:

- rollback preservation regression: pass;
- covered tests: 392/392 pass;
- changed-code coverage: 20 executable lines, 1 function and 11 branches at 100%;
- post-upgrade receipt confirmation regression: pass;
- ALCAMPO receipt-to-Store database proof: pass.

Earlier branch validation also passed Browser E2E with 142/142 scenarios, Security, container smoke, linux/amd64, linux/arm64 and CodeQL. The final PR head must preserve those gates; the GitHub PR is the delivery source of truth for their current state.

## Runtime verification

The fix is demonstrated in CI, but the original production log cannot reveal the SQLite failure that was masked. After this PR is deployed, retry the affected mobile receipt confirmation.

- If confirmation succeeds, the reproduced rollback-masking defect was sufficient to resolve the observed path.
- If confirmation still fails, the preserved `sqliteErrcode`/`sqliteErrstr` becomes the evidence for a separate minimal follow-up.
- A read-only SQLite health/schema diagnostic may be used at that point; it is not a prerequisite for this proven code fix.

## Rollback

The production change is limited to conditional transaction cleanup plus additional redacted log fields. Reverting the PR restores the former behavior; no schema or data migration is introduced by this fix.
