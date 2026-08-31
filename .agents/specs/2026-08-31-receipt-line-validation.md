# Receipt Line Validation UX

## Request

Fix the receipt-review dead end where a line can be marked as requiring review but the UI provides no explicit way to validate that individual line. A user must be able to inspect every arithmetic input that determines line validity, validate a single line without modifying unrelated rows, and receive actionable Spanish feedback before final import.

## Evidence

- `src/web/ui.js::receiptLine()` renders a warning status for any line that is not `confirmed`, but the row menu exposes only edit and delete actions.
- `src/web/receipt-review.js::handleReceiptAction()` has no line-validation action; only the global `Validar líneas` path calls `/api/v1/receipts/validate`.
- `confirmReceipt()` revalidates the draft but only blocks on `validation.total.valid`; it can call `/api/v1/receipts/confirm` while an individual line is still invalid.
- `src/receipts/import.ts::parseReceiptConfirmation()` correctly rejects any line whose canonical `validateReceiptLine()` result is not `confirmed`, producing the current English `Receipt item N must be corrected before confirmation` error after the UI already attempted import.
- `readReceiptItems()` preserves `discountMinor` from the extraction, and `validateReceiptLine()` subtracts that discount from the expected line total, but the receipt-review UI does not display or edit the discount. A row can therefore look arithmetically correct while failing canonical validation because an invisible value participates in the calculation.

## Decision

- Keep `src/domain/receipt.ts::validateReceiptLine()` as the single owner of receipt-line arithmetic. Do not duplicate arithmetic rules in the browser.
- Reuse the existing `/api/v1/receipts/validate` endpoint for line validation; no new validation endpoint or backend arithmetic implementation is needed.
- A line that is not confirmed exposes an explicit accessible `Validar` action in its row status area. The action validates the current draft and reports the selected line result without changing unrelated row values.
- Any existing `discountMinor` becomes a visible editable EUR field because it participates in canonical arithmetic. Cancelling the line editor restores it, compact summaries disclose it when present, and corrections include discount changes.
- `Confirmar e importar` must stop locally after `/validate` when any line is not confirmed. It must focus/scroll the first affected line, show actionable Spanish feedback, and never call `/confirm` for a draft the server validation already says cannot be imported.
- The backend import guard remains in place as defense in depth.

## Acceptance

1. A `needs-review`, `unreadable`, or arithmetic-mismatch line has a visible keyboard-accessible action to validate that line.
2. Activating the line action calls the canonical receipt-validation API and updates the line status to `Validada` when canonical arithmetic is confirmed.
3. When validation still fails, the selected line remains `Revisar` and the UI explains the reason in Spanish, including expected versus entered amount for arithmetic mismatch.
4. A `discountMinor` used by canonical validation is visible as an editable EUR input and is represented in the compact line summary.
5. Editing or clearing the discount is preserved by Save, restored by Cancel, and recorded as a correction.
6. Final confirmation does not POST `/api/v1/receipts/confirm` while any `/validate` line is not confirmed, even when the overall total is valid.
7. The first invalid line is brought into view/focus before the user is asked to retry confirmation.
8. Existing receipt OCR, AI recovery, evidence preservation, mobile editor, sticky summary, delete/undo, total validation and successful import flows remain intact.

## Checks

- focused Playwright receipt-line validation regressions
- `pnpm quality`
- Pull Request Quality, CodeQL and visual evidence on the exact PR head
- manual inspection of affected desktop and mobile receipt-review evidence

## Delivery

Create an atomic fix PR from current `main`. Do not merge, release, publish, deploy, change secrets, migrate data or weaken the backend confirmation guard.

## Status

Implementation in progress.
