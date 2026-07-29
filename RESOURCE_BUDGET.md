# Resource budget

## Enforced limits

| Resource | Limit |
| --- | ---: |
| Idle RSS in CI | 96 MiB |
| Representative request RSS in CI | 144 MiB |
| V8 heap used in CI | 64 MiB |
| RSS growth between repeated steady-state rounds | 24 MiB |
| Heap growth between repeated steady-state rounds | 8 MiB |
| Persistent growth after replaying idempotent operations | 64 KiB |
| Idle CPU over the measurement window | 1% |
| Application container memory and memory+swap | 192 MiB |
| V8 old-space ceiling | 128 MiB |
| Application PIDs | 128 |
| Application temporary filesystem | 32 MiB |
| Watchtower memory and memory+swap | 128 MiB |
| Watchtower PIDs | 64 |
| Watchtower temporary filesystem | 16 MiB |
| Container log retention | 3 files × 5 MiB per service |
| Startup | 5 seconds |
| Graceful shutdown | 20 seconds |

The V8 heap limit is intentionally below the container memory limit so native SQLite, buffers, runtime metadata, and the process supervisor retain headroom. Setting `memswap_limit` equal to `mem_limit` prevents the container from escaping the memory budget through swap.

## Persistent storage limits

- SQLite database: 512 MiB maximum through `PRAGMA max_page_count`.
- SQLite page cache: 8 MiB maximum.
- SQLite WAL journal target: 16 MiB through `journal_size_limit`, with bounded auto-checkpointing.
- Receipt evidence: 512 MiB deduplicated store.
- Migration backups: newest 3 and 768 MiB combined.
- Manual backups: newest 5 and 768 MiB combined.
- Watchtower removes superseded local images but is explicitly forbidden from removing application volumes.
- GHCR keeps the newest 10 immutable SHA-tagged releases; failed candidates are deleted unless they were promoted.

These are hard ceilings. Exceeding a data budget produces an explicit operation failure rather than unbounded disk growth.

## CI measurement

```bash
pnpm resource:measure
```

The command builds production JavaScript and runs the same server entrypoint used by Docker with `--expose-gc`. It performs three rounds of representative API reads and identical receipt confirmations, then asserts:

- absolute RSS and heap ceilings;
- bounded steady-state RSS and heap growth;
- bounded persistent growth for replayed idempotent operations;
- idle resource release;
- idle CPU, startup, and shutdown limits.

The command exits non-zero when any budget is exceeded. CI therefore enforces these values instead of merely printing measurements.

## Container and publication validation

Pull-request CI builds AMD64 and ARM64 images with SBOM and provenance, scans the image with Trivy, starts it under the production resource restrictions, checks `/readiness`, inspects cgroup limits, and verifies graceful shutdown.

After an approved merge, the main workflow publishes only the immutable SHA candidate first. It then checks the multi-architecture manifest, pulls the exact digest from GHCR, starts that digest under the same hard limits, checks its revision label and readiness, and only then promotes the identical manifest to `stable`.

## Raspberry Pi boundary

CI validates build contracts, emulated ARM64 construction, resource configuration, retention algorithms, and the published AMD64 runtime. Physical Raspberry Pi thermal behavior, storage latency, cgroup accounting, private-registry authentication, and interaction with other host containers remain deployment checks and must not be inferred from hosted-runner measurements.
