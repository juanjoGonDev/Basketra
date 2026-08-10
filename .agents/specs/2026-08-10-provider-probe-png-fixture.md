# Provider probe PNG fixture

## Request

Replace the inline synthetic OCR probe image used by the Settings AI provider check with a repository-owned, ordinary PNG fixture and keep the exact OpenAI-compatible request/strict-output contract.

The production evidence supplied by the operator shows the provider returning HTTP 200 but ChatGPT reading the attachment as `This image is unavailable because it is of an unsupported file type.` The companion webApi fix is PR #42.

## Evidence

- `OpenAiCompatibleProvider.testConnection()` currently embeds `PROVIDER_PROBE_PNG_DATA_URL` directly in `src/ai/provider.ts`.
- The current unit/integration contract verifies PNG signature and dimensions, but the fixture is hand-embedded and the real browser-backed provider rejected the resulting attachment as unsupported.
- The OpenAI-compatible `/v1/chat/completions` endpoint is JSON. A raw multipart upload would change the public provider contract and would not be OpenAI-compatible. The correct boundary is therefore: own a normal PNG file in Basketra, load its real bytes, and encode those bytes into the canonical `image_url` data URL at request construction time.
- webApi PR #42 addresses a separate browser lifecycle/prompt-flow issue and remains independently required for that runtime.

## Decision

- Add a repository-owned standard RGB PNG fixture at `src/ai/fixtures/provider-probe.png` containing visible text `BASKETRA OCR 4821`.
- Keep `test.png` as the generic transmitted filename so the expected text is not leaked through metadata.
- Load the fixture bytes from disk and build the `data:image/png;base64,...` value at runtime. Remove the large inline base64 literal from source.
- Copy `src/ai/fixtures` into the compiled `dist/ai/fixtures` artifact during `pnpm build`, so source execution and production compiled execution resolve the same relative asset.
- Keep the existing strict JSON Schema and exact OCR validation unchanged.
- Do not add dependencies, multipart transport, external fixture hosting, retries, or provider-specific branches.

## Acceptance

- Settings provider check uses bytes read from the checked-in PNG fixture.
- The fixture is a valid 600x120 RGB PNG and contains the OCR challenge visually.
- The transmitted request still uses one `image_url` part with filename `test.png`, detail `high`, and a PNG data URL generated from that exact file.
- Tests compare the transmitted decoded bytes to the repository fixture, not merely its signature/dimensions.
- Production build copies the fixture to the path resolved by compiled `provider.js`.
- Wrong OCR text/format and malformed structured output continue to fail closed.
- No secrets, receipt/user data, API schema, database, timeout, retry, release, or deployment behavior changes.
- Canonical CI must pass on the exact PR head before delivery is considered complete.

## Checks

- `pnpm quality`
- focused provider unit tests
- `pnpm test:integration`
- build/package smoke through canonical CI
- Docker/platform checks already defined by repository CI

## Risk

A repository asset introduces a build-packaging dependency. The build must copy it alongside compiled JS and tests must verify the packaged path exists. The OpenAI-compatible wire format intentionally remains JSON/data-URL; changing to multipart would be a breaking protocol change and is out of scope.

## Rollback

Revert this PR. No migration or data rollback is required.

## Delivery

Branch: `agent/fix-provider-probe-png-fixture`.
Target: `main` via a normal non-draft PR.
Do not merge, release, publish, deploy, or modify real secrets without explicit authorization.

## Status

Recon/spec complete; implementation and exact-head CI pending.
