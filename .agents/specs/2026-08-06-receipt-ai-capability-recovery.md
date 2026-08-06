# Receipt AI capability and recovery

## Request

Complete Basketra PR #14 using specification-driven development and test-driven development after the merged webApi attachment fix. Preserve existing contracts and architecture. Do not merge, release, deploy, publish an image, rotate secrets, modify Raspberry Pi, or claim production closure without approved live evidence.

## Evidence

- webApi requires attachment readiness and has passed its separate live image-attachment smoke test.
- Basketra completes local OCR before AI verification and can preserve the original capture and OCR evidence after a provider failure.
- OCR text alone cannot prove quantities, unit prices, discounts, tax categories, totals, or row/column relationships.
- The previous recovery copy incorrectly presented disabling AI as a normal success path.
- A `/models` request proves neither image attachment nor strict Structured Outputs.
- Chromium V8 block coverage omits a nested range when it inherits the parent execution count; cross-test aggregation must preserve that inheritance instead of converting an omitted range to zero.

## Decisions

1. `OpenAiCompatibleProvider` remains the only provider transport owner. The explicit Settings probe sends one bounded synthetic PNG plus strict `response_format: json_schema` through that same transport, with no automatic retry.
2. The probe reports configured capability separately from runtime-proven connectivity, model routing, authentication, image input, strict JSON output, response parsing, timeout, cancellation, and correlation.
3. `ReceiptExtractionService` owns separate bounded OCR and AI queues. Local OCR may use two slots while AI verification defaults to one canonical slot.
4. `StructuredAiExecutor` remains the only production retry owner and reuses one validated correlation identifier across bounded attempts.
5. Provider failures are normalized into stable, redacted `AI_*` codes. Provider bodies are bounded and only allowlisted metadata may influence classification.
6. Raw OCR is never accepted as a valid structured receipt after AI failure.
7. Captures and OCR survive AI failure. The user may retry with AI or enter explicit manual review.
8. Manual review treats OCR rows as unverified. Confirmation remains blocked until quantities, unit prices, line totals, and declared total pass explicit validation.
9. PDF failures without local OCR may enter blank manual entry while preserving the original PDF.
10. Delegated receipt actions fail closed when stale or malformed, and unknown future page states degrade to pending progress rather than crashing.
11. Browser changed-code coverage uses aggregated Chromium V8 ranges and inherits omitted nested ranges from the smallest containing range. Explicit zero ranges remain uncovered.

## Acceptance criteria

- [x] No receipt failure recommends disabling AI as if OCR were a valid structured result.
- [x] Every recognized `AI_*` failure has deterministic redacted guidance and retry-with-AI recovery.
- [x] AI failure preserves captures and local OCR evidence.
- [x] Manual review is explicit, remains unverified, and blocks import until row/total validation succeeds.
- [x] PDF provider failure supports blank manual entry without discarding the source file.
- [x] Cancellation, retry, multiple pages, one AI slot, two OCR slots, concurrency boundaries, and successful AI verification remain supported.
- [x] Provider diagnostics distinguish configuration from proven image-plus-strict-schema capability.
- [x] Basketra → webApi requests use managed Bearer authentication and validated correlation metadata without exposing credentials.
- [x] Error responses, logs, tests, and UI remain free of provider bodies, receipt content, OCR text, images, Base64, prompts, schemas, credentials, headers, filenames, and filesystem paths.
- [x] Changed backend production code reaches 100% line, function, and branch coverage.
- [x] Domain logic, `receipt-ai-recovery.js`, and `sw.js` have independent native 100% line, function, and branch gates.
- [x] Changed `operations.js` and `receipts.js` code has a blocking aggregated Chromium line, function, and branch coverage gate.
- [x] Formatting, lint, strict types, dead-code detection, dependency boundaries, unit, integration, API, repository E2E, browser, security, resource budgets, builds, container smoke, AMD64, ARM64, and CodeQL remain blocking.

## Tests

- Unit: queue FIFO/cancellation/release, separate OCR/AI limits, provider classification, retryability, response bounds, correlation, strict probe contract, recovery mappings, service worker, and V8 inherited-range aggregation.
- Integration/API: canonical authenticated multimodal strict-schema request, gateway mapping, static module delivery with security headers, PDF queue serialization, malformed and oversized responses, and error redaction.
- Browser/E2E: successful local OCR and AI flows, AI failure and retry, manual validation gate, multi-row manual review, PDF without OCR, cancellation, assembly failure, missing error code, stale delegated actions, unknown future state, configured/proven diagnostics, every stable provider code, responsive UI, offline shell, VPN recovery, uploads, backups, and security-sensitive copy.
- Containers: hardened smoke, vulnerability scan, runtime limits, graceful shutdown, and `linux/amd64` plus `linux/arm64` builds with SBOM/provenance.

## Security and privacy

- `BASKETRA_AI_API_KEY` is a managed webApi Bearer token; the removed static webApi `API_KEY` contract is not restored.
- Correlation identifiers are bounded metadata and never authorization input.
- Provider and API response sizes remain bounded.
- Client logs are untrusted, sanitized, bounded, and do not replace server-authoritative events.
- Raspberry validation must verify `AGENTA_CAPTURE_CONTENT=false` before any real receipt is processed.

## Delivery gate

The PR may be reported repository-complete only when Pull Request Quality, CodeQL, and PR visual evidence are green for the exact current head. Mutable run IDs are recorded in the PR delivery comment rather than embedded in this specification.

## External validation and rollback

Repository completion does not close production. Authenticated Basketra → webApi → ChatGPT and Raspberry one-image/three-image validation require explicit deployment approval. Before promotion, record the immutable candidate digests, the previous stable digest, target CPU/memory observations, one-slot AI queue behavior, and exact rollback commands. Code rollback is a focused revert; there is no schema or data migration.

## Status

Implementation, regression coverage, documentation, and repository delivery gates are complete when the exact PR head is green. Authenticated live-provider and Raspberry validation remain separate approval-gated external work and must not be represented as completed by repository CI.
