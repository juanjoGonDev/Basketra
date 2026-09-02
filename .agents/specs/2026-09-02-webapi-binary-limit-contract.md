# WebAPI binary capability contract

## Request

Stop Basketra from owning AI attachment limits. Use WebAPI as the only functional limit source, persist the last validated WebAPI capability snapshot in Basketra SQLite for temporary WebAPI capability-endpoint failures, and send durable receipt attachments as binary multipart instead of Base64 JSON.

## Evidence

- `ReceiptResponsesClient` currently serializes each receipt attachment as a Base64 data URL inside the JSON body sent to `POST /v1/responses`.
- A ~380 KiB image therefore expands materially before JSON framing and can be rejected by an unrelated WebAPI JSON parser ceiling before the configured 20 MiB image limit is evaluated.
- `OpenAiCompatibleProvider` already uses multipart binary for Chat Completions, but the durable Responses client is a separate transport owner and still uses Base64 JSON.
- `fetchAiRuntimeCapabilities()` always performs a no-store WebAPI read but does not persist a fallback.
- The outer operations route `/api/v1/ai/runtime-capabilities` returns an error whenever the live capability read fails, even if a previously validated WebAPI snapshot exists.
- Migration v1 already contains `ai_provider_configurations.capabilities_json`; no current runtime code owns that table, so a provider-scoped capabilities snapshot can be persisted without adding a conflicting schema migration.
- This repository is a single-user local application reachable through the owner's trusted LAN/VPN deployment. Public anonymous/multi-tenant threat assumptions are not product requirements.

## Decision

- WebAPI `GET /v1/capabilities` is the single source of truth for functional AI limits.
- Basketra never substitutes a Basketra-defined functional attachment maximum.
- On every successful validated WebAPI capability read, Basketra persists the exact validated capability snapshot in SQLite keyed to the configured WebAPI base URL/model.
- When a later capability read is temporarily unavailable, Basketra may use only the last validated WebAPI snapshot for provider validation and upload UX. The fallback is stale provider data, not Basketra policy.
- Durable `POST /v1/responses` requests use multipart/form-data with JSON metadata plus the original binary attachment. No Base64 attachment is emitted on the wire.
- Multipart transport must not compare binary attachment bytes against `requests.maxJsonBodyBytes`; JSON metadata and attachment limits are independent WebAPI capabilities.
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
- Regression tests cover binary wire transport, live-to-cached fallback, invalid capability payload rejection, and SQLite persistence/reopen.

## Checks

- Focused unit/integration tests for response multipart and capability caching.
- Database persistence/reopen regression.
- Existing receipt durable recovery and browser capability tests.
- `pnpm quality` through canonical CI plus required browser/container/security workflows.

## Risks

- A cached WebAPI snapshot can be stale after an operator changes limits while WebAPI is unreachable. Live fetch always has priority, and cache is used only after live failure.
- Reusing the existing provider-configuration table must remain narrowly scoped to the capability snapshot and must never persist the API token.
- The coordinated WebAPI multipart contract must land before or with the Basketra consumer change.

## Rollback

Revert the multipart Responses client and cached capability resolver together. The existing SQLite table remains compatible and no destructive migration is introduced.

## Delivery

Branch `agent/fix-webapi-limit-contract`. Coordinated WebAPI branch `agent/fix-dynamic-ai-limit-contract`. No merge, release, deploy, publication, secret mutation, or environment edit is authorized.

## Status

Repository trust-model instruction committed. Implementation pending.
