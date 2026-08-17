# Basketra AI production hardening

## Request

Finish Basketra's side of the AI integration so the Settings connectivity check exercises the real webApi attachment contract, remains safe to operate, and keeps required repository checks deterministic.

## Evidence

- `OpenAiCompatibleProvider.testConnection()` loads the checked-in JPEG fixture at `src/ai/fixtures/provider-probe.jpg`, uses the generic filename `test.jpg`, and requires a strict structured response whose image format is `jpg` and whose text matches the visible fixture text.
- `buildProviderRequest()` extracts the fixture bytes from the canonical attachment representation and emits one `multipart/form-data` request: JSON metadata is in `request`, and binary attachment bytes are in `files`. Attachment metadata is removed from the JSON, preventing a second base64/data-URL copy.
- The provider endpoint is resolved as `/v1/chat/completions`. A `GET /v1/capabilities` response, when available, supplies the authoritative attachment and request budgets before upload.
- `src/infrastructure/config.ts`, `.env.example`, and both Compose files expose no Basketra AI timeout setting. `BASKETRA_AI_TIMEOUT_MS` is not a supported configuration input.
- `src/api/errors.ts` and `src/web/operations.js` map stable provider failures to safe user guidance without exposing credentials, request headers, attachment contents, or raw provider responses.
- Current CI runs deterministic quality, browser, and container checks. It has no required live AI-provider smoke job.

## Scope

- Document the actual JPEG binary multipart connectivity contract, its configuration, timeout ownership, and safe error behavior.
- Preserve the provider client as the single request-contract owner and webApi as the authority for attachment/request limits.
- Keep deterministic contract tests separate from the optional manual live-provider check.

Out of scope: changing webApi limits or schemas, adding an AI timeout configuration, adding real credentials to CI, changing production topology, or modifying historical specifications.

## Decisions

1. The Settings check sends the compact repository-owned JPEG once as a `files` multipart part; request metadata is a separate `request` JSON part.
2. The image filename is generic and the expected OCR text is validated from the returned structured result, not inferred from a filename or prompt.
3. Basketra does not create a second application timeout. Provider/upstream timeout responses map to `AI_TIMEOUT`; caller abandonment propagates cancellation.
4. `/v1/capabilities`, when provided by webApi, is used to reject over-budget requests locally for user feedback, while webApi remains authoritative.
5. Required CI remains deterministic with local mocks. The deployed Settings action is the optional, manual live webApi smoke check.

## Risks

- Multipart support is a webApi contract dependency; protocol drift can cause rejection even when the provider URL is reachable.
- A provider can take longer than conventional REST requests. Removing a Basketra wall-clock deadline means an active client may occupy the bounded AI work until the provider returns or the caller disconnects.
- Live-provider results are operational evidence, not a reproducible CI signal; transient availability, rate limits, and model behavior must not gate normal CI.

## Acceptance criteria

- The connectivity check posts one real JPEG binary attachment to `/v1/chat/completions` using the canonical multipart `request`/`files` contract.
- Its generic filename and prompt do not reveal the expected visible text; a response passes only after strict JSON and exact semantic OCR validation.
- The request contains no duplicate base64/data-URL image payload in JSON and does not override multipart framing headers.
- Basketra documents no `BASKETRA_AI_TIMEOUT_MS` setting and attributes timeout outcomes to webApi/the provider.
- Documentation describes safe, actionable handling for connection, timeout, auth/configuration, attachment, schema/response, rate-limit, and provider errors.
- Required checks remain deterministic; optional live verification is manual and never carries credentials into CI.

## Test plan

```bash
node --experimental-strip-types --test \
  tests/unit/ai-provider-errors.test.ts \
  tests/unit/ai-runtime-capabilities.test.ts \
  tests/unit/provider-probe-contract.test.ts
pnpm test:integration
pnpm quality
```

The focused contracts inspect multipart content type, endpoint, authorization handling without logging secrets, generic JPEG filename and MIME type, exact fixture-byte transport, no JSON image duplication, strict response parsing, invalid/wrong OCR rejection, capability limits, and mapped errors. For an optional operational smoke check, configure private webApi credentials outside the repository, recreate Basketra, and use **Test AI provider** in Settings.

## Rollback considerations

Revert the Basketra AI hardening work as one coherent change if the deployed webApi contract is incompatible. No database migration, persisted receipt mutation, secret rotation, deployment, or provider-limit change is part of this work. Do not restore a Basketra timeout or raise limits as a workaround; first verify the canonical webApi contract.

## Delivery status

Documentation and deterministic contract coverage describe the current Basketra behavior. Final delivery remains contingent on the implementation branch's required CI checks for its exact pushed commit; the manual live-provider check is optional operational evidence.
