# Receipt Line Validation UX

## Request

Fix the receipt-review dead end where a line can be marked as requiring review but the UI provides no explicit way to validate that individual line. A user must be able to inspect every arithmetic input that determines line validity, including discounts, validate a single line without modifying unrelated rows, add a missing discount manually, and receive actionable Spanish feedback before final import.

The discount itself is valid receipt data, not an error condition. AI/OCR-detected discounts must remain visible and editable, and a user must be able to enter a discount even when extraction omitted it.

## Evidence

- `src/web/ui.js::receiptLine()` renders a warning status for any line that is not `confirmed`, but the row menu exposes only edit and delete actions.
- `src/web/receipt-review.js::handleReceiptAction()` had no line-validation action; only the global `Validar líneas` path called `/api/v1/receipts/validate`.
- `confirmReceipt()` revalidated the draft but only blocked on `validation.total.valid`; it could call `/api/v1/receipts/confirm` while an individual line was still invalid.
- `src/receipts/import.ts::parseReceiptConfirmation()` correctly rejects any line whose canonical `validateReceiptLine()` result is not `confirmed`, producing the English `Receipt item N must be corrected before confirmation` error after the UI already attempted import.
- `src/domain/receipt.ts::validateReceiptLine()` owns the arithmetic `quantity * unitPriceMinor - (discountMinor ?? 0)` and therefore already validates discounts as part of each line.
- `readReceiptItems()` preserved an extracted `discountMinor`, but the merged receipt-review UI did not display or edit it. A line could therefore contain a correctly detected discount that the user could not inspect, confirm, change, remove or add when extraction missed it.
- CI exposed an independent race in durable PDF recovery: a late refresh from a failed background job could repaint `Error` after the user explicitly selected manual review.

## Decision

- Keep `src/domain/receipt.ts::validateReceiptLine()` as the single owner of receipt-line arithmetic. Do not duplicate or automatically recalculate receipt arithmetic in the browser or E2E fixtures.
- Reuse the existing `/api/v1/receipts/validate` endpoint for line validation; no new validation endpoint or backend arithmetic implementation is needed.
- A line that is not confirmed exposes an explicit accessible `Revisar` / validate action in its row status area. The action validates the current draft and reports the selected line result without changing unrelated row values.
- `Descuento (€)` is a receipt-line editor field for every line, defaulting visually to `0.00` when extraction omitted it. Positive discounts are also disclosed in the compact line summary.
- When a line originally had no `discountMinor`, an untouched `0.00` remains omitted from the payload. Entering a positive discount adds `discountMinor`; changing an extracted discount to `0.00` explicitly removes its arithmetic effect and is recorded as a correction.
- A discount never makes a line invalid by itself. Canonical validation confirms the combined quantity, unit price, discount and entered line total. If adding or changing a discount changes the expected line amount, feedback exposes expected versus entered amounts so the user can correct the line total and, when necessary, the declared receipt total.
- `Confirmar e importar` stops locally after `/validate` when any line is not confirmed. It focuses/scrolls the first affected line, shows actionable Spanish feedback, and never calls `/confirm` for a draft the server validation already says cannot be imported.
- The backend import guard remains in place as defense in depth.
- An explicit manual-review page state overrides stale updates from the previous durable job. The failed job identity is retained so an explicit `Volver a analizar con IA` action can still create a retry from durable OCR evidence.

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

- focused Playwright receipt-line validation regressions, including extracted and manually added discounts
- E2E requests use the real `/api/v1/receipts/validate` endpoint; tests observe payloads without owning receipt arithmetic
- deterministic stale durable-job/manual-review regression
- `pnpm quality`
- Pull Request Quality, CodeQL and visual evidence on the exact PR head
- manual inspection of affected desktop and mobile receipt-review evidence

## Validation evidence

Functional head `f6ea2a9a66157b43c5776c07d767d58aa71fd779` passed:

- Pull Request Quality run `33422203404`: Quality, Security, Browser E2E, linux/amd64, linux/arm64 and Container smoke all `success`.
- CodeQL Advanced run `33422203346`: `success`.
- Publish PR visual evidence run `33422203432`: `success`; its PR comment and browser artifact both identify the same functional head.
- Browser artifact `basketra-browser-evidence` digest `sha256:f1c897addaa0baaec826d49a6f78487ba5694d00a7bff46bf03b71275b6677bf` was inspected directly.
- Final visual review inspected the four receipt-line-validation screenshots plus video frames for the extracted and manually added discount states. The editor showed `Descuento (€)` with the extracted `0.25` value, the manually added `0.25` value remained inside the responsive editor without overflow, the compact row disclosed `Dto. 0,25 €`, validated rows rendered `Validada`, and the invalid-confirmation state rendered the expected/entered EUR feedback and `Revisar` action without clipping.
- Local clone/test execution remained unavailable because the execution environment could not resolve GitHub; no local result is claimed.

## Delivery

Create an atomic fix PR from current `main`. Do not merge, release, publish, deploy, change secrets, migrate data or weaken the backend confirmation guard.

## Status

Implemented and ready for review. Runtime behavior and visual acceptance were validated on functional head `f6ea2a9a66157b43c5776c07d767d58aa71fd779`. This documentation-only closure commit does not change runtime behavior and still requires the repository's exact-head CI gates before delivery.
