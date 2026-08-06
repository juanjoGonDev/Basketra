# Receipt AI provider failure handling

## Context

Production receipt-page verification returned generic HTTP 500 `INTERNAL_ERROR` responses after local OCR had completed. The browser preserved the OCR text, but the actual provider failure was hidden behind an incident reference. This prevented the user from distinguishing a rejected multimodal request, unsupported capability, authentication failure, rate limit, timeout, oversized attachment, invalid response, network failure, or upstream provider failure.

## Requirements

- Keep local OCR evidence and explicit retry-with-AI or manual-review recovery intact.
- Never treat OCR text alone as an automatically valid structured receipt.
- Convert provider transport, HTTP, capability, response-size, empty-response and invalid-JSON failures into stable `AI_*` codes.
- Never expose or log the provider response body, receipt content, credentials, headers, URLs, filenames or filesystem paths.
- Mark only transient failures as retryable; deterministic 4xx, capability and authentication failures must not consume retry attempts.
- Map typed provider failures to actionable Spanish API messages and non-500 statuses where applicable.
- Preserve request cancellation as `AbortError` rather than converting it to a provider outage.
- Add regression coverage for classification, redaction, retry bounds and API mapping.

## Stable mapping

| Condition | Stable code | API status | Retryable |
| --- | --- | ---: | --- |
| HTTP 401/403 | `AI_AUTHENTICATION_FAILED` | 502 | No |
| HTTP 408/504 or local timeout | `AI_TIMEOUT` | 504 | Yes |
| HTTP 413 | `AI_ATTACHMENT_TOO_LARGE` | 413 | No |
| HTTP 429 | `AI_RATE_LIMITED` | 503 | Yes |
| Other HTTP 4xx | `AI_REQUEST_REJECTED` | 422 | No |
| HTTP 5xx | `AI_PROVIDER_FAILED` | 502 | Yes |
| Network failure | `AI_UNREACHABLE` | 502 | Yes |
| Missing image/PDF capability | capability-specific code | 422 | No |
| Empty/invalid provider response | response-specific code | 502 | Yes |
| Response over configured limit | `AI_RESPONSE_TOO_LARGE` | 502 | No |

## Acceptance criteria

- A failed `/api/v1/receipts/extract` AI phase returns its stable `AI_*` code instead of `INTERNAL_ERROR`.
- The receipt UI displays redacted code-specific guidance, preserves OCR evidence, and offers retry or explicit manual review.
- Manual review identifies OCR-derived rows as unverified and requires row/total validation before import.
- Provider error bodies remain absent from thrown errors, API responses and tests.
- Non-retryable provider errors execute exactly once even when the configured retry count is greater than zero.
- Transient provider failures retry only within the configured finite bound.
