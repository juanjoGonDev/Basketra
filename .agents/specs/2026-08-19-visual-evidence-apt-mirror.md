# Visual evidence media setup reliability

## Request

Continue PR #32 until its exact-head visual evidence can be published reliably after the authoritative browser workflow succeeds.

## Evidence

- Visual-evidence run `32197206419` reached `Install the media converter` after successfully locating and downloading the exact-head browser artifact.
- Its logs show `apt-get update` repeatedly ignoring `http://azure.archive.ubuntu.com/ubuntu` entries before falling back to the public Ubuntu archive for metadata, then remaining blocked until the job was cancelled by a later PR update.
- The job started the media setup at `2026-08-19T08:21:09Z` and was still blocked when cancelled at `2026-08-19T08:45:26Z`.
- A subsequent exact-head evidence run reached the same media-converter installation step, so the external mirror is a reproducible delivery risk rather than a product failure.
- Browser E2E, Quality, Security, amd64, arm64, container smoke and CodeQL were green before the evidence publisher reached this step.

## Decision

Keep the existing PNG/GIF/WebM evidence format and `ffmpeg` conversion contract. Do not add a third-party action or runtime dependency.

Make the existing package installation bounded and deterministic on GitHub-hosted Ubuntu runners:

1. Skip installation when `ffmpeg` is already available.
2. When `/etc/apt/apt-mirrors.txt` exists, replace the failing Azure Ubuntu mirror entry with the public HTTPS Ubuntu archive before `apt-get update`.
3. Apply bounded APT retries and HTTP/HTTPS timeouts.
4. Set a five-minute timeout on the media-converter setup step so this auxiliary publisher cannot consume almost the entire 30-minute job timeout.

## Acceptance

- The workflow preserves exact-head browser-artifact validation.
- The workflow preserves directly viewable PNG, GIF and WebM evidence.
- `ffmpeg` setup is skipped when already installed.
- Azure mirror fallback is explicit and limited to the hosted-runner mirror list when present.
- APT retries and network timeouts are bounded.
- The setup step has a five-minute timeout.
- A unit contract test protects these reliability constraints.
- Product code, APIs, dependencies and release/deployment behavior are unchanged.
- Pull Request Quality, CodeQL and exact-head visual evidence pass on the final head.

## Checks

- `pnpm test`
- `pnpm quality`
- Pull Request Quality
- CodeQL Advanced
- Publish PR visual evidence

## Rollback

Revert the workflow reliability commit and its focused unit/spec commits. No application state, schema, API or deployment migration is involved.

## Delivery

Branch: `agent/ui-android-native-redesign`.

Atomic Conventional Commits. PR #32 remains unmerged pending final visual review.

## Status

Root cause confirmed from cancelled run `32197206419`. Regression contract added in `6be70f4c2093293daae089ecf48054dc89049a5a`. Workflow fix pending.
