# Basketra foundation

## Request
Build the existing empty Basketra repository into a private, mobile-first grocery price intelligence application for Raspberry Pi.

## Evidence
- Remote repository existed with no implementation history before bootstrap.
- The default branch is `main` and the implementation branch is `agent/feat-basketra-foundation`.
- Production and CI use Node.js 22.23.1 with built-in `node:sqlite`.
- Pull-request CI executes quality, security, Chromium, container smoke, AMD64 and ARM64 jobs.
- The final runtime has no third-party npm dependencies and removes package managers after compilation.
- Receipt extraction supports embedded/manual text and configured OpenAI-compatible multimodal providers for images and PDFs when their capabilities are explicitly enabled.

## Decision
Use a dependency-free TypeScript modular monolith: Node HTTP API, built-in SQLite, static PWA, deterministic domain logic, provider-neutral OCR/AI/offer contracts, and Docker resource limits.

## Scope
Deployable and testable Basketra foundation: lists, local suggestions, validated receipt captures, multimodal or embedded-text extraction, human correction, transactional evidence import, structured provider contracts, price normalization, deterministic optimization, backup/validation, security defaults and mobile UI.

## Risks
- `node:sqlite` remains experimental in Node 22; Node is pinned and database access is isolated.
- Multimodal OCR accuracy and PDF support remain provider/model-specific; Basketra requires explicit capability flags and mandatory local validation.
- Live retailer/Amazon prices require evidence-producing provider integrations and cannot be synthesized by CI.
- Hosted ARM64 validation does not replace measurements on the user's physical Raspberry Pi and co-located workloads.

## Acceptance
See root `spec.md`; every claim must have executed evidence.

## Tests
- 24 unit tests passing with no skip, todo or retry.
- 2 integration tests using real temporary SQLite and HTTP.
- 1 static PWA acceptance test.
- 7 mobile Chromium flows passing with screenshots, video and traces, including validated capture upload, extraction, correction and transactional import.
- 100% lines, branches and functions for the deterministic domain coverage target.
- Frozen install, format, lint, strict typecheck, dead-code, dependency policy, build and security scan passing.
- Compose validation, HIGH/CRITICAL Trivy gate, hardened container smoke and graceful shutdown passing.
- AMD64 and ARM64 builds passing with SBOM and provenance.

## Rollback
Revert the feature branch or its commits; `main` only contains the bootstrap README until merge.

## Validation
Remote workflow `Pull Request Quality` run `30434680791` validated commit `7b7a9caaa29aa2a4bc3df2748b3f6f9846d9bf93` with the full green matrix before visual evidence publication.

Measured hosted-runner process evidence:
- startup: 109.76 ms;
- shutdown: 71.61 ms;
- idle RSS: 61.56 MiB;
- representative API RSS: 80.29 MiB;
- idle CPU: 0.039%;
- primary process count: 1;
- hibernated: true.

Container evidence:
- image size: 162,815,322 bytes;
- Trivy HIGH/CRITICAL gate: pass;
- hardened start, health probe and bounded shutdown: pass;
- `linux/amd64` and `linux/arm64`: pass.

Browser evidence:
- workflow run: https://github.com/juanjoGonDev/Basketra/actions/runs/30434680791;
- artifact: https://github.com/juanjoGonDev/Basketra/actions/runs/30434680791/artifacts/8716935809;
- artifact digest: `sha256:8fd643b88c3e5435061d1de591f28d175af8599dc70344a0b315e0785db5b5a1`;
- permanent repository media: `docs/evidence/playwright/`;
- each flow includes a complete PNG, original Playwright WebM and GIF preview for inline PR rendering.

## Delivery
Normal pull request #1 to `main`; no merge without user authorization.

## Status
Implementation, automated tests, documentation, visible browser evidence and remote CI are complete for the defined foundation scope. Live supermarket/Amazon evidence providers and physical Raspberry Pi measurements remain explicit external integration/deployment work, not hidden incomplete work.
