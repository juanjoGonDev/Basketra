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
Remote workflow `Pull Request Quality` run `30429561415` validated commit `d40b858fe4604186797a398d825b5ffd4e3192cc` before this final documentation update. The documentation commit must receive the same green matrix before delivery.

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
- artifact: `basketra-browser-evidence`;
- digest: `sha256:57cd0a58e10905f07f8263729b97e94ac13b7d523a12506928945bb09b4f985e`;
- contents: HTML report, screenshots, videos, traces and test results.

## Delivery
Normal pull request #1 to `main`; no merge without user authorization.

## Status
Implementation, automated tests, documentation and remote CI are complete for the defined foundation scope. Live supermarket/Amazon evidence providers and physical Raspberry Pi measurements remain explicit external integration/deployment work, not hidden incomplete work.