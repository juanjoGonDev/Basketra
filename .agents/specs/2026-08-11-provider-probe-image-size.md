# Provider probe image size regression

## Request

Fix the Settings AI capability probe failing with HTTP 413 / `AI_ATTACHMENT_TOO_LARGE` while preserving the existing OCR and strict structured-output validation.

## Evidence

- Production UI reports that the provider rejects the synthetic probe image because of its size.
- Basketra maps provider HTTP 413 to `AI_ATTACHMENT_TOO_LARGE`.
- The probe is sent inline as a PNG data URL through the canonical OpenAI-compatible `/v1/chat/completions` JSON request.
- The previous checked-in PNG contained substantial ancillary metadata and was significantly larger than necessary for a simple OCR challenge.
- PR #26 replaces only the fixture with a compressed PNG of about 240 KiB while preserving the visible OCR content and dimensions.
- The compressed PNG uses valid 8-bit indexed color, so the previous regression test's hard-coded RGB color-type assumption is no longer a valid contract.

## Decision

- Keep the compressed repository-owned PNG from PR #26 as the single source of truth for the capability probe bytes.
- Preserve the existing filename, prompt isolation, OCR text, strict response schema, provider protocol, and runtime packaging path.
- Update the fixture contract test to accept valid 8-bit RGB or indexed-color PNGs and require a palette for indexed color.
- Add a 256 KiB upper bound to prevent a future fixture replacement from silently reintroducing an oversized capability probe.
- Do not raise webApi request-size limits: its configured OpenCode JSON body limit is already orders of magnitude above this probe, so increasing it would not address the observed provider-side 413.

## Acceptance

- `provider-probe.png` remains readable and at least 600x120 with a 2:1 to 4:1 aspect ratio.
- The fixture is at most 256 KiB.
- The exact checked-in fixture bytes are the bytes sent to the provider.
- The expected OCR text is not leaked through prompt text or filename.
- The strict response remains `{ "image": { "format": "png", "text": "..." } }` and the exact visible text is still validated locally.
- Unit/integration/quality/security/container CI remains green on the final PR head.
- No API, database, secret, deployment, or provider-limit changes are introduced.

## Checks

- `pnpm test -- tests/unit/provider-probe-contract.test.ts` or the repository-equivalent focused unit test command.
- `pnpm quality`.
- Canonical Pull Request Quality and CodeQL workflows on the exact final head.

## Risk

The smaller indexed-color PNG must remain compatible with the provider/browser image path. Indexed PNG is a standard PNG representation; the test explicitly validates its PNG structure and palette while keeping the real provider capability check as the production acceptance signal.

## Rollback

Revert PR #26. No data or schema rollback is required.

## Delivery

Branch: `fix/reduce-img-size`.
Target: `main` via existing PR #26.

## Status

Compressed fixture and regression contract update applied; exact-head CI pending.
