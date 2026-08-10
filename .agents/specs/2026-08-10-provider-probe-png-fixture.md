# Provider probe PNG fixture

## Request

Replace the inline synthetic OCR probe image used by the Settings AI provider check with a repository-owned, ordinary PNG fixture and keep the exact OpenAI-compatible request/strict-output contract.

The production evidence supplied by the operator shows the provider returning HTTP 200 but ChatGPT reading the attachment as `This image is unavailable because it is of an unsupported file type.` The companion webApi fix is PR #42.

## Evidence

- `OpenAiCompatibleProvider.testConnection()` previously embedded `PROVIDER_PROBE_PNG_DATA_URL` directly in `src/ai/provider.ts`.
- The old unit/integration contract verified PNG signature and fixed dimensions, but the fixture was hand-embedded and the real browser-backed provider rejected the resulting attachment as unsupported.
- The OpenAI-compatible `/v1/chat/completions` endpoint is JSON. A raw multipart upload would change the public provider contract and would not be OpenAI-compatible. The correct boundary is therefore: own a normal PNG file in Basketra, load its real bytes, and encode those bytes into the canonical `image_url` data URL at request construction time.
- The operator uploaded the final high-contrast PNG fixture after visually checking it. Its dimensions are intentionally not a wire contract; readability, valid RGB encoding, exact transmitted bytes and a sane landscape aspect ratio are the relevant properties.
- Increasing the real fixture payload exposed a pre-existing cancellation-test defect: the mock provider did not consume the request body, so the test became sensitive to HTTP backpressure. The regression now drains the complete provider request before disconnecting the inbound client, which tests the intended cancellation behavior after upload rather than mock-server buffering.
- webApi PR #42 addresses a separate browser lifecycle/prompt-flow issue and remains independently required for that runtime.

## Decision

- Add a repository-owned standard RGB PNG fixture at `src/ai/fixtures/provider-probe.png` containing visible text `BASKETRA OCR 4821`.
- Keep `test.png` as the generic transmitted filename so the expected text is not leaked through metadata.
- Load the fixture bytes from disk and build the `data:image/png;base64,...` value at runtime. Remove the large inline base64 literal from source.
- Copy `src/ai/fixtures` into the compiled `dist/ai/fixtures` artifact during `pnpm build`, so source execution and production compiled execution resolve the same relative asset.
- Keep the existing strict JSON Schema and exact OCR validation unchanged.
- Validate a readable landscape RGB fixture (`width >= 600`, `height >= 120`, aspect ratio between 2:1 and 4:1) instead of coupling tests to one exact export size.
- Keep cancellation deadlines referenced and ensure the provider mock consumes the complete request before asserting cancellation, avoiding false failures caused by fixture-size backpressure.
- Do not add dependencies, multipart transport, external fixture hosting, retries, or provider-specific branches.

## Acceptance

- Settings provider check uses bytes read from the checked-in PNG fixture.
- The fixture is a valid 8-bit RGB PNG, is at least 600x120, has a 2:1–4:1 landscape aspect ratio, and contains the OCR challenge visually.
- The transmitted request still uses one `image_url` part with filename `test.png`, detail `high`, and a PNG data URL generated from that exact file.
- Tests compare the transmitted decoded bytes to the repository fixture, not merely its signature/dimensions.
- Production build copies the fixture to the path resolved by compiled `provider.js`.
- Wrong OCR text/format and malformed structured output continue to fail closed.
- Provider cancellation remains verified after the complete, real-sized fixture request has reached the upstream server.
- No secrets, receipt/user data, API schema, database, timeout, retry, release, or deployment behavior changes.
- Canonical CI must pass on the exact PR head before delivery is considered complete.

## Checks

- `pnpm quality`
- focused provider unit tests
- `pnpm test:integration`
- build/package smoke through canonical CI
- Docker/platform checks already defined by repository CI
- browser E2E and CodeQL workflows already defined by repository CI

## Risk

A repository asset introduces a build-packaging dependency. The build copies it alongside compiled JS and tests verify that the transmitted bytes are exactly the checked-in fixture. The OpenAI-compatible wire format intentionally remains JSON/data-URL; changing to multipart would be a breaking protocol change and is out of scope.

A large fixture can also expose backpressure in synthetic HTTP tests. The cancellation test now consumes the provider request body before measuring downstream cancellation, matching the intended provider behavior without weakening the cancellation assertion.

## Rollback

Revert this PR. No migration or data rollback is required.

## Delivery

Branch: `agent/fix-provider-probe-png-fixture`.
Target: `main` via a normal non-draft PR.
Do not merge, release, publish, deploy, or modify real secrets without explicit authorization.

## Status

Implementation complete. Provider unit and integration contracts are green on the implementation head, including exact fixture-byte transport and cancellation with the real-sized payload. Final canonical CI is pending on the documentation head and must be fully green before delivery is considered complete.
