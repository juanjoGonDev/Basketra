# Resource budget

## Targets

- idle RSS: <= 80 MiB;
- representative API RSS: <= 128 MiB;
- container memory hard limit: 192 MiB;
- effectively zero idle CPU;
- bounded process count and graceful shutdown within 20 seconds.

## Reproducible measurement

```bash
pnpm resource:measure
/usr/bin/time -v pnpm start

docker image inspect basketra:local --format '{{.Size}}'
docker stats --no-stream basketra
```

The script builds production JavaScript, starts the same `dist/main.js` entrypoint used by Docker, exercises representative API requests, waits for hibernation, and reports startup, shutdown, RSS, heap, CPU, process and thread counts.

## Local process evidence

Measured on July 29, 2026 with Node.js 22.16.0:

| Metric | Result | Target | Status |
| --- | ---: | ---: | --- |
| Startup | 12.97 ms | bounded | pass |
| Idle RSS | 58.37 MiB | <= 80 MiB | pass |
| Representative API RSS | 77.07 MiB | <= 128 MiB | pass |
| Returned-to-idle RSS | 77.70 MiB | <= 128 MiB | pass |
| Heap used | 10.39 MiB | informational | measured |
| Idle CPU, 2-second sample | 0.188% | effectively zero | pass |
| Graceful shutdown | 3.23 ms | <= 20 s | pass |
| Primary process count | 1 | 1 | pass |
| Node thread count | 11 | bounded | measured |
| SQLite database size | 4,096 bytes | informational | measured |
| Hibernated state | true | required | pass |

The initial development-only TypeScript runtime measured approximately 112 MiB idle RSS and failed the target. Production therefore runs compiled JavaScript instead of Node's TypeScript stripping mode. The measurement above verifies that decision against the production entrypoint.

## Pending container evidence

Container image size, ARM64 execution, cgroup CPU/memory behavior and container PID limits require a Docker daemon. They are measured by the pull-request workflow and must not be reported as passed until remote CI completes.

## Hibernation

`BASKETRA_IDLE_HIBERNATE_AFTER_MS` defaults to five minutes. Hibernation removes temporary files and releases optional provider state. `IDLE_EXIT_AFTER_MS` is disabled by default; when enabled, an external supervisor is required because Docker cannot wake a stopped container from an HTTP request.
