# Basketra foundation

## Request
Build the existing empty Basketra repository into a private, mobile-first grocery price intelligence application for Raspberry Pi.

## Evidence
- Remote repository existed with no commit history before bootstrap.
- The default branch was `main` and the implementation branch is `agent/feat-basketra-foundation`.
- The execution environment has Node.js 22.16 and built-in `node:sqlite`, but no Docker daemon or browser runtime.

## Decision
Use a dependency-free TypeScript modular monolith: Node HTTP API, built-in SQLite, static PWA, deterministic domain logic, provider-neutral OCR/AI/offer contracts, and Docker resource limits.

## Scope
Foundation that is deployable and testable without external services: lists, local suggestions, receipt evidence/import, structured provider contracts, price normalization, deterministic optimization, backup/validation, security defaults and mobile UI.

## Risks
- `node:sqlite` is experimental in Node 22; pin Node and isolate database access.
- Real OCR accuracy and browser automation require an external OCR engine and Playwright browser binaries.
- Live retailer/Amazon prices require evidence-producing provider integrations and cannot be validated in CI.

## Acceptance
See root `spec.md`; every claim must have executed evidence.

## Tests
Unit domain coverage, SQLite integration, HTTP API integration, PWA static acceptance, security regressions, build and lint/type gates.

## Rollback
Revert the feature branch or its commits; `main` only contains the bootstrap README until merge.

## Validation
Record exact local and remote commands in the PR.

## Delivery
Normal pull request to `main`; no merge without user authorization.

## Status
Implemented locally and validated. Remote browser/container CI pending publication.
