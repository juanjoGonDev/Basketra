# Receipt Line Validation UX

## Request

Fix the receipt-review dead end where a line can be marked as requiring review but the UI provides no explicit way to validate that individual line. A user must be able to inspect every arithmetic input that determines line validity, including discounts, validate a single line without modifying unrelated rows, add a missing discount manually, and receive actionable Spanish feedback before final import.

The discount itself is valid receipt data, not an error condition. AI/OCR-detected discounts must remain visible and editable, and a user must be able to enter a discount even when extraction omitted it.

## Evidence

- `src/web/ui.js::receiptLine()` renders a warning status for any line that is not `confirmed`, but the row menu exposes only edit and delete actions.
- `src/web/receipt-review.js::handleReceiptAction()` has no line-validation action; only the global `Validar líneas` path calls `/api/v1/receipts/validate`.
- `confirmReceipt()` revalidates the draft but only blocks on `validation.total.valid`; it can call `/api/v1/receipts/confirm` while an individual line is still invalid.
- `src/receipts/import.ts::parseReceiptConfirmation()` correctly rejects any line whose canonical `validateReceiptLine()` result is not `confirmed`, producing the current English `Receipt item N must be corrected before confirmation` error after the UI already attempted import.
- `src/domain/receipt.ts::validateReceiptLine()` owns the arithmetic `quantity * unitPriceMinor - (discountMinor ?? 0)` and therefore already validates discounts as part of each line.
- `readReceiptItems()` preserves an extracted `discountMinor`, but the merged receipt-review UI does not display or edit it. A line can therefore contain a correctly detected discount that the user cannot inspect, confirm, change, remove or add when extraction missed it.

## Decision

- Keep `src/domain/receipt.ts::validateReceiptLine()` as the single owner of receipt-line arithmetic. Do not duplicate or automatically recalculate receipt arithmetic in the browser.
- Reuse the existing `/api/v1/receipts/validate` endpoint for line validation; no new validation endpoint or backend arithmetic implementation is needed.
- A line that is not confirmed exposes an explicit accessible `Validar` action in its row status area. The action validates the current draft and reports the selected line result without changing unrelated row values.
- `Descuento (€)` is a canonical receipt-line editor field for every line, defaulting visually to `0.00` when extraction omitted it. Positive discounts are also disclosed in the compact line summary.
- When a line originally had no `discountMinor`, an untouched `0.00` remains omitted from the payload. Entering a positive discount adds `discountMinor`; changing an extracted discount to `0.00` explicitly removes its arithmetic effect and is recorded as a correction.
- A discount never makes a line invalid by itself. Canonical validation confirms the combined quantity, unit price, discount and entered line total. If adding/changing a discount changes the expected line amount, feedback exposes expected versus entered amounts so the user can correct the line total.
- `Confirmar e importar` must stop locally after `/validate` when any line is not confirmed. It must focus/scroll the first affected line, show actionable Spanish feedback, and never call `/confirm` for a draft the server validation already says cannot be imported.
- The backend import guard remains in place as defense in depth.
- CI uncovered an independent stale durable-job refresh race during manual PDF recovery. It must be made deterministic without weakening recovery or hiding the retry action before this PR can be considered green.

## Acceptance

1. A `needs-review`, `unreadable`, or arithmetic-mismatch line has a visible keyboard-accessible action to validate that line.
2. Activating the line action calls the canonical receipt-validation API and updates the line status to `Validada` when canonical arithmetic is confirmed.
3. When validation still fails, the selected line remains `Revisar` and the UI explains the reason in Spanish, including expected versus entered amount for arithmetic mismatch.
4. Every receipt line exposes an editable `Descuento (€)` input, even when extraction did not provide `discountMinor`.
5. An extracted positive discount is visible in both the editor and compact summary and participates unchanged in canonical validation.
6. A user can add a previously missing discount, validate the resulting line arithmetic, save it as `discountMinor`, and later confirm/import the receipt once all line and total validation passes.
7. Editing or clearing an extracted discount is preserved by Save, restored by Cancel, and recorded as a correction; an untouched zero for a previously absent discount does not create a false correction.
8. Final confirmation does not POST `/api/v1/receipts/confirm` while any `/validate` line is not confirmed, even when the overall total is valid.
9. The first invalid line is brought into view/focus before the user is asked to retry confirmation.
10. A late refresh from a previously failed durable job cannot overwrite a user's explicit `manual` page state; explicit AI retry remains available.
11. Existing receipt OCR, AI recovery, evidence preservation, mobile editor, sticky summary, delete/undo, total validation and successful import flows remain intact.

## Checks

- focused Playwright receipt-line validation regressions, including extracted and manually-added discounts
- deterministic stale durable-job/manual-review regression
- `pnpm quality`
- Pull Request Quality, CodeQL and visual evidence on the exact PR head
- manual inspection of affected desktop and mobile receipt-review evidence

## Delivery

Create an atomic fix PR from current `main`. Do not merge, release, publish, deploy, change secrets, migrate data or weaken the backend confirmation guard.

## Status

Implementation in progress.
