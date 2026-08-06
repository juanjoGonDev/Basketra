# Receipt AI capability and recovery

## Request

Complete Basketra PR #14 after the merged webApi attachment fix. Use SDD and TDD. Do not merge, release, deploy, publish, rotate secrets, or modify Raspberry Pi.

## Evidence

- webApi requires attachment readiness and has passed a live image attachment smoke test.
- Basketra preserves local OCR before entering AI verification.
- OCR text alone is not a trustworthy structured receipt: quantities, unit prices, discounts, taxes, totals, and column relationships require AI verification or explicit human review.
- The previous receipt error copy incorrectly suggested disabling AI as a normal recovery path.
- The provider diagnostic now sends a bounded synthetic image and strict JSON Schema through the canonical provider transport.
- The receipt UI and service worker load the dedicated recovery owner through the production gateway, covered by an integration regression test.

## Decision

1. Keep the canonical synthetic image plus strict JSON Schema capability probe. It tests authentication, model routing, image input, strict structured output, parsing, timeout, cancellation, correlation, and stable redacted errors without automatic retries.
2. Never treat raw OCR as an automatically valid receipt after AI failure.
3. Preserve OCR and captures after AI failure and expose two explicit actions:
   - retry the same page with AI;
   - enter manual review, where OCR-derived rows are only a draft and confirmation is blocked until the user runs explicit row/total validation.
4. Use code-specific recovery guidance for authentication, network, timeout, rate limit, attachment size/upload, capability, request rejection, invalid/empty/oversized response, and provider failure.
5. PDF pages without local OCR may enter blank manual review while preserving the original capture.
6. Keep `ReceiptExtractionService`, `StructuredAiExecutor`, and `OpenAiCompatibleProvider` as the existing single owners. Add no dependency and no second provider transport.

## Acceptance criteria

- [x] No receipt failure message recommends disabling AI as if OCR were a valid structured result.
- [x] Every recognized `AI_*` failure has deterministic redacted guidance and a retry-with-AI action.
- [x] AI failures expose an explicit manual-review action without marking OCR as verified.
- [x] A manual-review page is a terminal processing state, but receipt confirmation remains blocked until explicit validation succeeds.
- [x] Retry, cancellation, multiple pages, one AI slot, OCR preservation, and normal successful AI verification remain unchanged.
- [x] Provider diagnostics distinguish configured state from proven image-plus-strict-schema capability.
- [x] Tests cover recovery mappings, provider transport, gateway delivery, API behavior and the browser recovery workflow.
- [x] Domain logic and the dedicated recovery owner reach 100% line/function/branch coverage using Node's native coverage metrics.
- [ ] Formatting, lint, types, dead code, dependency boundaries, unit, integration, E2E, browser, security, build, resource budgets, container smoke, AMD64, ARM64, CodeQL, and visual evidence pass on the exact final head.

## Security and privacy

- Never log or return receipt text, OCR text, images, Base64, prompts, schemas, response bodies, credentials, cookies, authorization headers, filenames, or filesystem paths.
- Provider bodies remain bounded and allowlisted.
- Correlation identifiers remain bounded metadata and are never authorization input.
- Raspberry validation must confirm `AGENTA_CAPTURE_CONTENT=false` and a managed webApi Bearer token before processing real receipts.

## Tests

- Unit tests cover every stable recovery mapping, malformed/future errors, provider classifications, retryability, correlation, response limits and the strict capability probe.
- Integration tests cover the canonical OpenAI-compatible multimodal request and direct delivery of the recovery browser module with security headers.
- Browser tests cover AI failure, OCR preservation, redaction, retry availability, explicit manual review, blocked import before validation, validation and confirmed import.
- Existing cancellation, concurrency, multi-page, local OCR, API, storage, backup, security and responsive flows remain blocking.

## External validation and rollback

Repository completion does not close production. Authenticated Basketra → webApi → ChatGPT and Raspberry one-/three-image validation require explicit deployment approval. Record the previous immutable image digest and exact rollback commands before promotion. Code rollback is a focused revert; there is no schema or data migration.

## Status

Repository implementation is complete on existing PR #14. Exact-head CI is pending. Authenticated live-provider and Raspberry validation remain approval-gated external work.
