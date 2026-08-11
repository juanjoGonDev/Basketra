# Provider probe JPEG and local quality regression

## Request

Fix the Settings AI capability probe failing with HTTP 413 / `AI_ATTACHMENT_TOO_LARGE`, finish the operator's JPEG conversion without stale PNG wire metadata, keep `@types/node` available for editor tooling without breaking the repository's custom Node ambient declarations, and add pinned Lefthook pre-commit/pre-push quality gates comparable to webApi.

## Evidence

- Production UI reports that the provider rejects the synthetic probe image because of its size.
- Basketra maps provider HTTP 413 to `AI_ATTACHMENT_TOO_LARGE`.
- PR #26 now stores the OCR challenge as `src/ai/fixtures/provider-probe.jpg`, but the initial JPEG branch revision still sent those JPEG bytes as `test.png`, declared `format: png`, used `data:image/png`, and retained PNG-specific symbol names.
- The initial JPEG branch revision also left PNG parsing/assertions in the provider contract tests.
- Pull Request Quality run `31472884383` failed because `@types/node@26` was auto-injected into a Node 22 project where `src/types/*.d.ts` already owns intentionally minimal Node ambient declarations. That revision also expanded the root `tsconfig.json` to type-check every test, exposing unrelated legacy test typings that the canonical source typecheck did not previously own.
- Basketra runs Node 22.23.1. The editor dependency should match the Node 22 type line and must not be auto-injected into the source TypeScript project that consumes the repository-owned ambient declarations.
- webApi uses pinned Lefthook with pre-commit and pre-push gates plus a postinstall hook installer that skips CI, production installs, and non-Git working trees.
- After isolating the editor typings and aligning the primary JPEG contracts, Pull Request Quality run `31474320557` passed TypeScript, dependency policy, security, container smoke, and the updated JPEG tests; its remaining unit failure was a stale PNG expectation in `tests/unit/ai-provider-errors.test.ts`, which has now been aligned to JPEG.
- Pull Request Quality run `31474536490` then passed all unit/integration/E2E behavior but changed-code coverage failed because a whole-file formatting rewrite in `src/ai/provider.ts` made an unrelated existing PDF-capability branch appear changed. The provider source has been restored to main's formatting so the PR diff now contains only the actual JPEG probe lines.

## Decision

- Keep the operator-provided JPEG as the single source of truth for the capability probe bytes.
- Align all runtime probe metadata to JPEG: `test.jpg`, `format: jpg`, `data:image/jpeg`, and JPEG-named constants/helpers.
- Replace PNG parsing in the probe regression with deterministic JPEG signature/dimension validation while preserving exact transmitted-byte comparison, readability bounds, prompt isolation, strict structured output, and a 256 KiB fixture ceiling.
- Centralize JPEG dimension parsing for the unit and integration contracts under `tests/helpers/jpeg.ts` instead of duplicating marker parsing.
- Restore the previous PNG/Docker task specifications instead of rewriting historical evidence to describe the new JPEG task.
- Keep `@types/node` as a development-only editor aid, pin it to the Node 22 type line, and configure the root TypeScript project with `types: []` so repository-owned Node ambient declarations remain authoritative for application source. Restore the canonical root include to `src/**/*.ts` rather than broadening source typecheck ownership to all tests.
- Add exact `lefthook@2.1.8`, matching the established webApi tooling line.
- Add `lefthook.yml` with fast pre-commit format/lint/security gates and canonical `pnpm quality` on pre-push.
- Add a dependency-free `scripts/install-hooks.mjs` postinstall installer that exits cleanly for `CI=true`, `NODE_ENV=production`, `SKIP_GIT_HOOKS=true`, missing `.git`, or missing Git.
- Add regression coverage for the hook configuration, exact tool versions, TypeScript ambient-type isolation, and installer safety guards.
- Keep `src/ai/provider.ts` changes narrowly scoped to the JPEG probe contract; do not create artificial coverage obligations by reformatting unrelated branches.
- Do not raise webApi or Basketra attachment/body limits; that would mask rather than fix the oversized/mislabeled synthetic probe.

## Acceptance

- `provider-probe.jpg` is a valid JPEG, at most 256 KiB, at least 600x120, and keeps a 2:1 to 4:1 landscape aspect ratio.
- The exact checked-in JPEG bytes are sent as `data:image/jpeg;base64,...` with generic filename `test.jpg` and `detail: high`.
- The strict response remains `{ "image": { "format": "jpg", "text": "..." } }`, and the exact visible OCR text is validated locally.
- Expected OCR text is absent from prompts and filename.
- No current runtime/test/task identifier falsely describes the JPEG probe as PNG; historical completed PNG task specifications remain intact.
- `@types/node` is exact, Node-22-compatible, development-only, and does not conflict with `src/types/*.d.ts` during canonical source typecheck/build.
- Lefthook is exact and development-only; pre-commit runs bounded format/lint/security checks and pre-push runs canonical quality.
- Hook installation never mutates Git hooks in CI, production installs, explicit skip mode, or non-Git package installs.
- `pnpm quality`, browser build/E2E, security, container smoke, AMD64/ARM64 builds, and CodeQL pass on the exact final PR head.
- No API, database, secret, deployment, release, publication, or provider-limit changes are introduced.

## Checks

- focused provider JPEG contract test
- focused Git hooks/tooling contract test
- `pnpm quality`
- canonical Pull Request Quality, visual-evidence, and CodeQL workflows on the exact final head

## Risk

JPEG is lossy, but the production capability check itself still requires exact OCR text, so unreadable compression fails closed. The regression validates JPEG structure, dimensions, byte ceiling, and exact transport rather than assuming a specific encoder implementation.

Installing full Node typings alongside repository-owned ambient declarations creates declaration conflicts if both participate in the same configured project. `types: []` makes that ownership explicit while retaining the package for editor/inferred projects.

Git hooks must never become a consumer/runtime requirement. Lefthook remains a pinned development dependency, installation is guarded, CI installs continue with scripts disabled, and production runtime remains dependency-free.

## Rollback

Revert the PR commits for JPEG metadata/tests and hook tooling. No data or schema rollback is required.

## Delivery

Branch: `fix/reduce-img-size`.
Target: `main` via existing PR #26.
No merge, release, publish, deploy, or remote migration is authorized by this task.

## Status

Implementation is complete. Exact-head Pull Request Quality, visual evidence, and CodeQL remain the final validation authority.
