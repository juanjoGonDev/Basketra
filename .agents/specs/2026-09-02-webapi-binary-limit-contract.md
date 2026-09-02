# WebAPI binary capability contract

## Request

Stop Basketra from owning AI attachment limits. Use WebAPI as the only functional limit source, persist the last validated WebAPI capability snapshot in Basketra SQLite for temporary WebAPI capability-endpoint failures, and send durable receipt attachments as binary multipart instead of Base64 JSON.

## Evidence

- `ReceiptResponsesClient` previously serialized each receipt attachment as a Base64 data URL inside the JSON body sent to `POST /v1/responses`.
- A ~380 KiB image therefore expanded materially before JSON framing and could be rejected by an unrelated WebAPI JSON parser ceiling before the configured 20 MiB image limit was evaluated.
- `OpenAiCompatibleProvider` already used multipart binary for Chat Completions, while the durable Responses client was a separate transport owner and still used Base64 JSON.
- Final review found that `OpenAiCompatibleProvider` still estimated multipart binary bytes against `requests.maxJsonBodyBytes`; that violated the same JSON/binary budget separation even though the wire transport was multipart.
- `fetchAiRuntimeCapabilities()` performs a no-store WebAPI read and validates the returned capability document.
- Migration v1 already contains `ai_provider_configurations.capabilities_json`; the cache reuses that provider-scoped persistence without adding a schema migration.
- This repository is a single-user local application reachable through the owner's trusted LAN/VPN deployment. Public anonymous/multi-tenant threat assumptions are not product requirements.

## Decision

- WebAPI `GET /v1/capabilities` is the single source of truth for functional AI limits.
- Basketra never substitutes a Basketra-defined functional attachment maximum.
- On every successful validated WebAPI capability read, Basketra persists the exact validated capability snapshot in SQLite keyed to the configured WebAPI base URL/model.
- When a later capability read is temporarily unavailable, Basketra may use only the last validated WebAPI snapshot for provider validation and upload UX. The fallback is stale provider data, not Basketra policy.
- The cache is installed as an explicit process-level fetch decorator from `main.ts`. It intercepts only the exact configured WebAPI capabilities URL, delegates every other request unchanged, never masks `401`/`403`, and restores the original fetch during shutdown. Propagating an additional fetch dependency through `OperationsGateway`, `BasketraServer`, provider and durable-client constructors was reviewed but rejected here as broader final-review churn without a demonstrated functional defect.
- Durable `POST /v1/responses` requests use multipart/form-data with JSON metadata plus the original binary attachment. No Base64 attachment is emitted on the wire.
- Multipart transport does not compare binary attachment bytes against `requests.maxJsonBodyBytes`; JSON metadata and attachment limits are independent WebAPI capabilities. This applies both to the durable Responses client and the multipart Chat Completions provider path.
- Preserve MIME/signature validation, durable idempotency, OCR evidence, response reconciliation, and local persistence behavior.
- Root `AGENTS.md` records the LAN/VPN single-user deployment model and the WebAPI SSOT rule so future agents do not reintroduce competing limits based on a hypothetical public deployment.

## Acceptance

- A ~380 KiB JPEG/PNG is sent to `/v1/responses` as binary and is not Base64-expanded in the HTTP body.
- Basketra does not reject an AI attachment using a locally owned functional size limit.
- A live WebAPI capability read is attempted before provider work and successful snapshots are persisted in SQLite.
- If the capabilities endpoint later fails, the last validated snapshot can be used without inventing defaults or Basketra policy.
- If no validated snapshot exists and WebAPI capabilities are unavailable, the failure remains explicit.
- Browser capability UX can receive the cached WebAPI snapshot during a temporary endpoint failure.
- Cache identity does not leak API keys or secrets.
- Multipart Chat Completions applies `maxJsonBodyBytes` only to JSON metadata; binary attachment bytes remain governed by their attachment-class limit.
- Regression tests cover binary wire transport, JSON/binary budget separation, live-to-cached fallback, invalid capability payload rejection, and SQLite persistence/reopen.

## Checks

- Focused unit/integration coverage validates response multipart transport and capability caching.
- Database persistence/reopen regression is covered.
- Provider runtime-capability coverage includes an attachment larger than the JSON budget but smaller than the live image limit and requires the multipart request to succeed.
- Canonical Pull Request Quality covers quality, changed-code coverage, resource/growth budgets, Browser E2E, linux/amd64, linux/arm64, container smoke and Security.
- CodeQL and visual-evidence publication are required exact-head delivery gates.
- Browser E2E publishes a compact PNG-only screenshot artifact so final visual review does not depend on downloading the complete Playwright report/traces archive.
- Final browser evidence must cover Settings mobile/tablet widths and the relevant receipt/error states with no horizontal overflow, inaccessible actions, functional misalignment or hidden error feedback.

## Risks

- A cached WebAPI snapshot can be stale after an operator changes limits while WebAPI is unreachable. Live fetch always has priority, and cache is used only after live failure.
- The process-level fetch decorator is intentionally narrow but remains global process state. Its exact-URL matching, delegation behavior and restoration are covered by integration tests; widening its interception scope would require redesign.
- Reusing the existing provider-configuration table must remain narrowly scoped to the capability snapshot and must never persist the API token.
- The coordinated WebAPI multipart contract must land before or with the Basketra consumer change.

## Rollback

Revert the multipart Responses client, provider JSON-budget correction and cached capability resolver together. The existing SQLite table remains compatible and no destructive migration is introduced.

## Delivery

Branch `agent/fix-webapi-limit-contract`. Coordinated WebAPI branch `agent/fix-dynamic-ai-limit-contract`. No merge, release, deploy, publication, secret mutation, or environment edit is authorized.

## Status

Implementation is prepared. Delivery is complete only when the current Basketra PR head has green exact-head Quality, Browser E2E, container, Security, CodeQL and visual-evidence gates, the compact screenshot evidence has been inspected, and companion WebAPI PR #108 remains exact-head green. Any gate or visual defect reopens implementation.
