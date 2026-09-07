# Runtime temporary-storage fallback

## Request

Receipt confirmation still fails after PR #56 was merged and the verified `stable` image was published. The operator wants image updates to remain zero-touch through the existing scoped Watchtower and does not want Raspberry-side rebuilds or manual container recreation after normal application updates. Runtime/log diagnostics must make the active temporary-storage mode observable without exposing filesystem paths or sensitive receipt data.

## Evidence

- PR #56 merged into `main` as `379dc4f8c84279ddfef8eb15d86c79021bf859f7` at 2026-09-07T09:59:06Z.
- Protected-main publication run `34109010580` completed successfully at 2026-09-07T10:00:54Z. The exact immutable image digest was pulled, smoke-tested, promoted to `stable`, and the promoted manifest was verified.
- Production attempts at 2026-09-07T11:01:28.968Z and 2026-09-07T11:06:35.110Z still failed with `ERR_SQLITE_ERROR`, SQLite extended code `6410`, and `disk I/O error`.
- Current `compose.raspberry.yml` gives `/tmp/basketra` `mode=0700,uid=1000,gid=1000`, but Watchtower updates an existing container from an image and does not fetch/re-apply repository Compose definitions.
- The application currently trusts `config.tempDir` without proving it is usable before restore/database bootstrap.
- PR #56 already provides a strong file-backed SQLite TEMP probe which reproduces extended code 6410 when the temporary directory is unusable.
- PR #57 CI reproduced and rejected an intermediate design that attempted fallback after SQLite had already been loaded; the hardened broken-primary container failed with `RUNTIME_TEMP_STORAGE_UNAVAILABLE`. The bootstrap was then moved before SQLite imports, and the final design isolates the strong candidate probe in a child process.
- Implementation head `34364f77d9894ae925e8f7be1c11eb4849e4dffd` passed Pull Request Quality `34119170212`, including Quality, resource/growth budgets, Security, linux/amd64, linux/arm64, Browser E2E, primary SQLite storage, and the deliberately broken-primary automatic fallback container.
- CodeQL run `34119170177` passed for Actions and JavaScript/TypeScript. Visual-impact run `34119170184` passed classification and correctly skipped direct visual evidence because the task has no UI impact.

## Decision

Prepare runtime temporary storage before any restore or SQLite database is opened.

Use the configured `tempDir` as the preferred location. Prove each candidate with a bounded filesystem write probe and the same canonical file-backed SQLite TEMP behavior used by container publication. Run the strong SQLite candidate probe in an isolated child process so the parent process does not load SQLite until after a directory has been selected. If the preferred location is unavailable, unwritable, or rejected by the SQLite probe, create and verify a private `runtime-tmp` directory under the persistent Basketra data directory, set `SQLITE_TMPDIR` and `TMPDIR` to it, and pass that effective temporary directory to the application runtime.

The fallback is runtime-owned and image-delivered. It therefore works when Watchtower updates a container whose inherited host mount contract is stale, without requiring a Raspberry rebuild or Compose recreation.

The canonical probe logic lives in source code. The image probe script delegates to it instead of maintaining a second SQLite probe implementation.

Expose only the temporary-storage mode (`primary` or `data-fallback`) through runtime metadata and bounded application logs. Do not expose filesystem paths.

## Scope

Included:

- runtime temporary-directory verification before restore/database bootstrap;
- automatic persistent-data fallback for an unusable preferred temporary directory;
- canonical SQLite TEMP probe shared by bootstrap and image verification;
- effective `AppConfig.tempDir` propagation after fallback;
- runtime metadata and bounded application-log observability;
- CI/local/published-image regression for a deliberately unusable preferred tmpfs;
- deployment documentation.

Excluded:

- schema changes or migrations;
- persistent database mutation or repair;
- Watchtower configuration changes;
- host-side Docker/Compose mutation;
- merge, release, deployment, or Raspberry remote commands.

## Risks

- The fallback uses the persistent data volume for temporary files when the preferred tmpfs is unusable, so transient SQLite/file work can consume persistent-volume I/O until the host mount contract is corrected.
- A failing or full persistent data volume cannot be self-healed by this mechanism; startup must fail closed if both preferred and fallback storage are unusable.
- Watchtower still cannot apply future host deployment-contract changes from repository Compose files. Runtime behavior must not depend on such a change for normal application upgrades.

## Acceptance

1. Runtime verifies the preferred temporary directory before `applyPendingRestore` or any application database bootstrap.
2. Verification uses a file-backed SQLite TEMP operation strong enough to reproduce code 6410 for an unusable directory, executed in an isolated child process for each candidate before the parent loads SQLite.
3. If preferred storage passes, `SQLITE_TMPDIR`, `TMPDIR`, and effective `AppConfig.tempDir` use it.
4. If preferred storage fails, Basketra creates a mode-0700 fallback under `dataDir`, verifies it, updates both environment variables, and uses it as effective `AppConfig.tempDir`.
5. If both candidates fail, startup fails rather than silently continuing with an unverified location.
6. `/api/v1/runtime` exposes only `tempStorage.mode`, never a path.
7. Application logs emit one bounded `server.temp_storage` event with code `PRIMARY` or `DATA_FALLBACK`.
8. `scripts/sqlite-temp-probe.mjs` delegates to the source-owned canonical probe.
9. Local Docker smoke, PR container smoke, and protected-main published-image smoke prove both the normal primary path and the broken-primary automatic fallback path.
10. Existing data, migrations, and `basketra-data` remain untouched.
11. Exact-head Quality, Security, container smoke, linux/amd64, linux/arm64, Browser E2E, CodeQL, and visual-impact classification are green.

## Checks

- `pnpm quality`
- Security
- hardened container smoke primary path
- hardened container smoke broken-primary fallback path
- linux/amd64
- linux/arm64
- Browser E2E
- CodeQL
- visual-impact classification
- protected-main publication contracts

## Rollback

Revert this PR. No database or schema rollback is required because the change only selects verified temporary storage at process bootstrap.

## Delivery

Branch: `agent/fix-runtime-temp-fallback`.

Target: `main`.

Do not merge, release, deploy, mutate the Raspberry, or perform destructive data operations without explicit operator approval.

## Status

Implementation acceptance is satisfied on head `34364f77d9894ae925e8f7be1c11eb4849e4dffd`: Pull Request Quality `34119170212`, CodeQL `34119170177`, and visual-impact classification `34119170184` are green. The strong SQLite probe is isolated per candidate, the hardened broken-primary container reaches readiness in `data-fallback` mode, and Browser E2E is terminal green. This documentation-only synchronization follows that validated implementation head and must itself retain the repository's standard exact-head CI before delivery.
