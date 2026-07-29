# ADR 0001: Dependency-free modular monolith

- Status: Accepted
- Date: 2026-07-29

## Context

Basketra runs on a Raspberry Pi already hosting other workloads. Idle RAM/CPU and operational simplicity outweigh framework convenience.

## Decision

Use one Node.js 22 process, built-in HTTP, `node:sqlite`, static PWA files, and explicit modules. Do not add Redis, a broker, an external database, microservices, or resident workers.

## Consequences

The deployment is small and has no runtime package supply chain. The project owns more HTTP and validation plumbing, so integration tests and centralized helpers are mandatory. `node:sqlite` is experimental and Node must remain pinned until the API stabilizes.
