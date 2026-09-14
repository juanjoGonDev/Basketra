# Persisted HTTP listen port

## Request
Make the HTTP listen port changeable by the operator. Editing a port anywhere in the repository had no effect: the process always came up on 3000.

## Evidence
- `loadConfig()` returns a frozen bootstrap pair (`127.0.0.1:3000` locally, `0.0.0.0:3000` in a container) and reads nothing else, so no edit outside that constant reaches the socket.
- `LOCAL_DEVELOPMENT.md` promised a `.env` loaded through `--env-file-if-exists=.env` and a `.env.example` to copy. Neither the flag nor the file exists, and `tests/unit/local-runtime-contract.test.ts` explicitly asserts that `BASKETRA_HOST`, `BASKETRA_PORT` and the rest of the legacy application environment cannot change bootstrap configuration.
- `scripts/security-scan.mjs` forbids `process.env` and `BASKETRA_` inside `src/infrastructure/config.ts` and forbids `${` interpolation in `compose.yml`, so an environment-variable port is closed off by policy in both places.
- `RuntimeSettingsStore` already owns the other operator-adjustable runtime values (`maxBodyBytes`, `idleHibernateAfterMs`, AI provider identity), which is the boundary `AGENTS.md` names for this kind of setting.

## Scope
- Add `listenPort` to the runtime-settings contract: schema column, defaults, bounded parsing, persistence, public projection and the Settings editor field.
- Bind the gateway to the persisted port at startup, keeping an explicitly pinned non-default bootstrap port authoritative so ephemeral-port tests and diagnostics are unaffected.
- Fall back to port 3000 with a `LISTEN_PORT_UNAVAILABLE` warning when the persisted port cannot be bound, so a bad value cannot lock the operator out of the editor.
- Surface unrecoverable bind failures instead of masking them behind the fallback.
- Correct the local-development and Raspberry documentation that described a non-existent environment-configuration surface.

## Decisions
1. The port belongs to the existing SQLite runtime-settings boundary, not to environment variables, per the repository deployment trust model.
2. `AppConfig.port` remains the bootstrap default and stays free of environment reads; the persisted value owns the socket only when the bootstrap port is still the default.
3. Startup never fails because a chosen port is busy: the process keeps serving on 3000 and records the reason.
4. `EADDRINUSE` and `EACCES` are the only recoverable bind failures; anything else propagates so misconfiguration stays visible.
5. The port applies at the next start rather than rebinding live, because rebinding would drop the very request that changed it.

## Acceptance
- A port saved in **Ajustes → IA → Red y recursos locales** is the port the next start listens on, and it survives a restart.
- Values outside `1..65535`, non-integers and unknown keys are rejected before persistence.
- An occupied persisted port produces `LISTEN_PORT_UNAVAILABLE` and a healthy service on 3000.
- A pinned non-default bootstrap port still wins over the persisted value.
- Documentation no longer references `.env`, `.env.example` or `BASKETRA_*` application variables.
- Unit, integration, static quality and changed-code coverage pass.

## Rollback
Revert migration 17 and the runtime-settings, gateway, editor and documentation changes. Databases that already ran migration 17 keep an unused `listen_port` column and continue to serve on the bootstrap port.
