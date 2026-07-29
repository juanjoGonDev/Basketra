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

## Pull-request runner evidence

Measured on July 29, 2026 with Node.js 22.23.1 on the GitHub-hosted Ubuntu runner:

| Metric | Result | Target | Status |
| --- | ---: | ---: | --- |
| Startup | 109.76 ms | bounded | pass |
| Idle RSS | 61.56 MiB | <= 80 MiB | pass |
| Representative API RSS | 80.29 MiB | <= 128 MiB | pass |
| Returned-to-idle RSS | 80.29 MiB | <= 128 MiB | pass |
| Heap used | 10.18 MiB | informational | measured |
| Idle CPU, measurement window | 0.039% | effectively zero | pass |
| Graceful shutdown | 71.61 ms | <= 20 s | pass |
| Primary process count | 1 | 1 | pass |
| Node thread count | 7 | bounded | measured |
| SQLite database size | 4,096 bytes | informational | measured |
| Hibernated state | true | required | pass |

The initial development-only TypeScript runtime measured approximately 112 MiB idle RSS and failed the target. Production therefore runs compiled JavaScript instead of Node's TypeScript stripping mode.

## Container evidence

Pull-request CI validated the production image on July 29, 2026:

- image size: 162,815,322 bytes (155.27 MiB);
- successful `linux/amd64` build with SBOM and provenance;
- successful `linux/arm64` build with SBOM and provenance;
- Compose configuration validation;
- Trivy scan passing with exit-on-finding for fixed HIGH and CRITICAL vulnerabilities;
- read-only root filesystem, dropped capabilities, `no-new-privileges`, PID limit, 192 MiB memory limit and 0.75 CPU limit during smoke execution;
- health endpoint reached successfully;
- graceful container stop completed inside the 20-second bound.

The runtime stage removes npm, Corepack, pnpm and Yarn because Basketra does not need package-management tooling after compilation. This avoids shipping vulnerable, unused package-manager libraries in the executable filesystem.

## Raspberry Pi validation boundary

The ARM64 image build and emulated execution path are validated by CI. Physical Raspberry Pi measurements for thermal behavior, storage latency, cgroup accounting and interaction with the user's other containers remain hardware-specific deployment validation. They must not be inferred from the hosted-runner figures above.

## Hibernation

`BASKETRA_IDLE_HIBERNATE_AFTER_MS` defaults to five minutes. Hibernation removes temporary files and releases optional provider state. `IDLE_EXIT_AFTER_MS` is disabled by default; when enabled, an external supervisor is required because Docker cannot wake a stopped container from an HTTP request.
