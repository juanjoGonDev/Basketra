# Provider OCR capability probe

## Request

Strengthen the AI provider Settings check so it proves the configured OpenAI-compatible provider can receive a real image, read visible text from that image, and return the result through strict JSON Schema. The test image filename must not reveal the visible text.

## Evidence

- The current capability probe sends a synthetic PNG and accepts exactly `{ "accepted": true }`.
- That contract proves attachment transport plus structured output, but it does not prove that the provider actually inspected the image or can read image content.
- Production provider checks currently fail through webApi after the browser reply flow returns invalid synthetic fallback text; the companion webApi fix owns that transport/reply-capture failure.

## Decision

- Keep one canonical `OpenAiCompatibleProvider.testConnection()` request; do not reintroduce a parallel `/models` probe.
- Replace the content-free probe with a deterministic repository-owned PNG that visibly contains a fixed OCR challenge string.
- Use a generic filename such as `test.png`; the expected OCR text must not appear in the filename, system prompt, user prompt, correlation id, schema name, or other request metadata.
- Request strict structured output with this shape:

```json
{
  "image": {
    "format": "png",
    "text": "<visible image text>"
  }
}
```

- Validate both the format and the exact expected visible text locally before reporting success.
- Include the optional image filename on the multimodal content part because the configured webApi provider already consumes that field when materializing data-URL attachments.
- Keep the probe bounded, no-retry at the Settings boundary, dependency-free, and free of receipt/customer data.

## Scope

- `src/ai/provider.ts` capability-probe request and validation.
- Existing provider unit and OperationsGateway integration coverage.
- Task-specific documentation only.

## Non-goals

- Change production receipt extraction prompts or schemas.
- Add OCR dependencies or external fixture services.
- Change provider credentials, URLs, retries, or deployment configuration.
- Merge, release, deploy, or modify the Raspberry host.

## Risks

- The expected text must never be leaked into the prompt because that would allow a provider to pass without vision.
- The fixture must be a valid non-trivial image and remain small enough for a cheap diagnostic request.
- Exact OCR validation intentionally makes the capability check stricter than simple attachment acceptance.

## Acceptance criteria

- [ ] The probe sends one valid PNG containing visible text.
- [ ] The image filename is `test.png` (or an equivalent generic filename) and differs from the visible OCR text.
- [ ] Neither prompt contains the expected OCR text.
- [ ] Strict JSON Schema requires `image.format` and `image.text`, with `format` constrained to `png`.
- [ ] The provider check succeeds only when returned text matches the visible image text and the format is `png`.
- [ ] Wrong text, wrong format, missing fields, and malformed provider output fail the check.
- [ ] Unit and integration tests inspect the actual request shape and image payload without adding runtime dependencies.
- [ ] `pnpm quality` and PR CI are green before delivery is considered complete.

## Checks

- `pnpm quality`
- `pnpm test:integration`
- `pnpm test:e2e`
- `pnpm test:browser`
- `pnpm docker:smoke` when Docker is available
- repository CI/security/platform checks on the PR head

## Rollback

Revert the focused PR. No database or data migration is involved.

## Delivery status

Implementation in progress on `agent/fix-provider-ocr-probe`. No merge, release, deployment, or secret mutation is authorized by this task.
