# Receipt AI capability and recovery

## Request

Complete Basketra PR #14 after the merged webApi attachment fix. Use SDD and TDD. Do not merge, release, deploy, publish, rotate secrets, or modify Raspberry Pi.

## Evidence

- webApi now requires attachment readiness and has passed a live image attachment smoke test.
- Basketra already preserves local OCR before entering AI verification.
- OCR text alone is not a trustworthy structured receipt: quantities, unit prices, discounts, taxes, totals, and column relationships require AI verification or explicit human review.
- The current receipt error copy incorrectly suggests disabling AI as a normal recovery path.
- The current provider diagnostic now sends a bounded synthetic image and strict JSON Schema through the canonical provider transport, but exact-head CI is red because `src/web/operations.js` lacks its final newline.

## Decision

1. Keep the canonical synthetic image plus strict JSON Schema capability probe. It must test authentication, model routing, image input, strict structured output, parsing, timeout, cancellation, correlation, and stable redacted errors without automatic retries.
2. Never treat raw OCR as an automatically valid receipt after AI failure.
3. Preserve OCR and captures after AI failure and expose two explicit actions:
   - retry the same page with AI;
   - enter manual review, where OCR-derived rows are only a draft and confirmation is blocked until the user runs explicit row/total validation.
4. Use code-specific recovery guidance for authentication, network, timeout, rate limit, attachment size/upload, capability, request rejection, invalid/empty/oversized response, and provider failure.
5. PDF pages without local OCR may enter blank manual review while preserving the original capture.
6. Keep `ReceiptExtractionService`, `StructuredAiExecutor`, and `OpenAiCompatibleProvider` as the existing single owners. Add no dependency and no second provider transport.

## Acceptance criteria

- No receipt failure message recommends disabling AI as if OCR were a valid structured result.
- Every recognized `AI_*` failure has deterministic redacted guidance and a retry-with-AI action.
- AI failures expose an explicit manual-review action without marking OCR as verified.
- A manual-review page is a terminal processing state, but receipt confirmation remains blocked until explicit validation succeeds.
- Retry, cancellation, multiple pages, one AI slot, OCR preservation, and normal successful AI verification remain unchanged.
- Provider diagnostics distinguish configured state from proven image-plus-strict-schema capability.
- Tests are written before behavior, cover all recovery mappings and browser recovery flows, and focused changed logic reaches 100% line/function/branch coverage using Node's native coverage metrics.
- Formatting, lint, types, dead code, dependency boundaries, unit, integration, E2E, browser, security, build, container smoke, AMD64, ARM64, CodeQL, and visual evidence pass on the exact final head.

## Security and privacy

- Never log or return receipt text, OCR text, images, Base64, prompts, schemas, response bodies, credentials, cookies, authorization headers, filenames, or filesystem paths.
- Provider bodies remain bounded and allowlisted.
- Correlation identifiers remain bounded metadata and are never authorization input.
- Raspberry validation must confirm `AGENTA_CAPTURE_CONTENT=false` and a managed webApi Bearer token before processing real receipts.

## External validation and rollback

Repository completion does not close production. Authenticated Basketra → webApi → ChatGPT and Raspberry one-/three-image validation require explicit deployment approval. Record the previous immutable image digest and exact rollback commands before promotion. Code rollback is a focused revert; there is no schema or data migration.

## Status

Implementation in progress on existing PR #14.
