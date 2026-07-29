# Basketra foundation

## Request
Build the existing empty Basketra repository into a private, mobile-first grocery price intelligence application for Raspberry Pi.

## Evidence
- Remote repository existed with no implementation history before bootstrap.
- The default branch is `main` and the implementation branch is `agent/feat-basketra-foundation`.
- Production and CI use Node.js 22.23.1 with built-in `node:sqlite`.
- Pull-request CI executes quality, security, Chromium, container smoke, AMD64 and ARM64 jobs.
- The final runtime has no third-party npm dependencies and removes package managers after compilation.

## Decision
Use a dependency-free TypeScript modular monolith: Node HTTP API, built-in SQLite, static PWA, deterministic domain logic, provider-neutral OCR/AI/offer contracts, and Docker resource limits.

## Scope
Foundation that is deployable and testable without external services: lists, local suggestions, receipt evidence/import, structured provider contracts, price normalization, deterministic optimization, backup/validation, security defaults and mobile UI.

## Risks
- `node:sqlite` remains experimental in Node 22; Node is pinned and database access is isolated.
- A production OCR engine is not bundled; real OCR accuracy remains provider-specific integration work.
- Live retailer/Amazon prices require evidence-producing provider integrations and cannot be synthesized by CI.
- Hosted ARM64 validation does not replace measurements on the user's physical Raspberry Pi and co-located workloads.

## Acceptance
See root `spec.md`; every claim must have executed evidence.

## Tests
- 18 unit tests passing with no skip, todo or retry.
- 2 integration tests using real temporary SQLite and HTTP.
- 1 static PWA acceptance test.
- 7 mobile Chromium flows passing with screenshots, video and traces.
- 100% lines, branches and functions for the deterministic domain coverage target.
- Frozen install, format, lint, strict typecheck, dead-code, dependency policy, build and security scan passing.
- Compose validation, HIGH/CRITICAL Trivy gate, hardened container smoke and graceful shutdown passing.
- AMD64 and ARM64 builds passing with SBOM and provenance.

## Rollback
Revert the feature branch or its commits; `main` only contains the bootstrap README until merge.

## Validation
Remote workflow `Pull Request Quality` run 10 validated commit `328a98747fd45c0ae59490604d5e12d1ea3aae1b` before documentation-only evidence updates. A final workflow run must validate the documentation head before delivery.

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

## Delivery
Normal pull request #1 to `main`; no merge without user authorization.

## Status
Implementation, automated tests, documentation baseline and remote CI are complete for the defined foundation scope. Production OCR, live supermarket/Amazon providers and physical Raspberry Pi measurements remain explicit external integration/deployment work.
