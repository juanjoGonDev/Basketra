# Automatic receipt review flow

## Request

Restore the agreed ticket workflow after the current UI/runtime regression:

- uploading a receipt image starts processing automatically; there is no explicit second processing step;
- receipt controls and secondary information use progressive disclosure instead of rendering every control and every page detail at once;
- local OCR is the recoverable baseline for JPEG/PNG pages;
- configured AI is an optional correction layer and must never turn a successfully OCR'd image into a blocking page error;
- after an AI correction failure, keep the OCR result reviewable, keep the original capture visible during manual correction, and always offer both manual review and an AI-only retry;
- retrying AI must reuse the existing OCR draft plus the original attachment instead of repeating OCR.

## Evidence

- The deployed screenshot shows a permanent `Paso 2 / Extrae y revisa` region, a manual `Leer con OCR local` button, an always-visible AI switch, aggregate progress and manual-review controls simultaneously.
- The deployed screenshot also shows all three captures as `Error` after an optional AI/background failure, even though the UI says the capture and partial OCR were preserved.
- `src/web/index.html` still owns the explicit `Paso 1` / `Paso 2` layout and exposes the AI switch, extraction button and manual-review section together.
- `uploadFiles()` stores captures but only marks them ready; processing starts later through `processReceipt()`.
- `processCapture()` already performs the desired page-local sequence: OCR first, then AI with the original attachment plus bounded OCR text. Its single outer error boundary currently converts an AI failure into the same fatal `error` state as an OCR failure.
- The AI-enabled manual action routes through the persisted aggregate background job; `failBackgroundJob()` marks every page `error`, so that path cannot preserve successful page-local OCR when AI fails.
- The canonical product spec requires local OCR for JPEG/PNG, preservation of the draft after OCR or AI failure, editable receipt rows and human review before persistence.
- The accepted receipt-pool UI spec requires a real two-slot OCR pool and a flatter, less card-heavy, mobile-first interface.

## Decision

1. Remove numbered processing steps from the ticket UI. Capture is the initiating action; no `Leer con OCR local` button is required for the normal flow.
2. After each successful upload batch, enqueue only newly stored captures into the existing browser page pool. Preserve already completed/in-flight page work when more captures are appended.
3. Keep the existing two-slot `activePageTasks`/`runToken` scheduler as the single browser concurrency owner.
4. The normal automatic flow uses page-local OCR followed by optional AI. Do not route new uploads through the aggregate background job because that contract cannot degrade an AI-only failure to the page's valid OCR result.
5. Treat AI correction as best-effort after OCR success:
   - preserve `rawText` and the OCR extraction as the page result;
   - record AI correction state/error separately from the primary page status;
   - keep the page reviewable/completed when AI fails;
   - continue final deterministic assembly from the OCR result.
6. Add an AI-only retry action. It sends the original stored capture plus the existing page OCR text to AI and never repeats OCR.
7. AI correction failure always exposes two recovery actions for that capture: `Revisar manualmente` and `Volver a analizar con IA`.
8. Manual review opens the grouped ticket editor and selects the affected capture as visual evidence. JPEG/PNG show the stored image beside/above editable rows; PDF shows an accessible document reference without pretending the image preview endpoint supports PDF.
9. Use progressive disclosure:
   - `Opciones de análisis` contains the optional AI toggle and is collapsed by default;
   - capture cards keep a compact summary and collapse verbose progress/error detail by default except the affected active/recovery card;
   - retailer, total, rows and confirmation live in one grouped review panel that opens when a reviewable result is ready or the user explicitly requests manual review.
10. Preserve persisted background-job restoration for pre-existing drafts if needed for compatibility, but it is no longer the owner of the normal upload workflow.
11. Bump the service-worker shell revision with the changed frontend assets.

## Acceptance

- There is no visible `Paso 1`, `Paso 2` or `Leer con OCR local` control in the normal Tickets workflow.
- Uploading three JPEG/PNG captures starts processing without another click, immediately fills at most two page-pool slots and leaves only overflow captures pending.
- Adding a later capture does not reset or repeat OCR for already completed captures.
- Analysis options are grouped/collapsed by default; enabling AI remains possible before a capture is uploaded.
- A successful OCR followed by `AI_UNREACHABLE`, timeout, rate limit, capability or other `AI_*` failure remains a reviewable page rather than `Error`.
- An AI-only failure does not block assembly, editable rows, total validation or confirmation.
- The affected capture exposes `Revisar manualmente` and `Volver a analizar con IA`.
- `Volver a analizar con IA` sends the original attachment and existing OCR draft without issuing a second local-OCR request.
- Manual review keeps the selected image visible while editable ticket rows are available; switching the selected capture updates the reference without losing edits.
- A genuine OCR failure remains an actionable blocking error for that page.
- Existing cancellation, stale-run isolation, same-run duplicate protection, retailer detection, arithmetic validation, idempotent confirmation and evidence preservation remain intact.
- The grouped workflow has no horizontal overflow at 320/360/390/430/768 CSS px, preserves browser zoom, keyboard focus and reduced motion.

## Tests

- Playwright: upload auto-starts OCR and there is no explicit second-step/process button.
- Playwright: three captures still fill exactly two pool slots and the third waits.
- Playwright: append a capture after an earlier page completed without reprocessing the earlier page.
- Playwright: AI failure after OCR keeps the page reviewable, opens manual review with the image reference and exposes AI-only retry.
- Playwright: AI-only retry reuses OCR and does not create another OCR request.
- Playwright: genuine OCR failure still blocks that page and remains retryable.
- Existing receipt cancellation, pool recovery, unknown-state, responsive and confirmation suites.
- `pnpm quality`, Browser E2E changed-code coverage, container smoke/builds, Security and CodeQL.

## Risks

- Auto-start can accidentally reset in-flight work when users add another batch. Mitigation: enqueue only new capture keys and separate combined-review invalidation from page-task invalidation.
- Treating AI failure as nonfatal could hide loss of correction quality. Mitigation: explicit per-capture warning state plus visible manual and AI-retry actions; never present failed AI as successful AI verification.
- AI-only retry can race an existing page task. Mitigation: reuse the same task registry, run token, page version and duplicate-task guard.
- A source image beside editable rows can consume mobile space. Mitigation: stacked compact reference on small screens and split/sticky evidence layout only when width permits.

## Rollback

Revert the focused frontend workflow/UI/test commits. No database migration, API contract, dependency, deployment or persistent-data rewrite is required.

## Delivery

Continue branch `agent/ui-android-native-redesign` and PR #32. Use atomic Conventional Commits. Keep the PR open and unmerged until final visual/runtime review is accepted.

## Status

Regression confirmed on head `9dfb7272d6502d4a4251359f5416416ccb0231a1`. Implementation pending.
