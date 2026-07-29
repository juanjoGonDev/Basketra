# ADR 0003: Exact financial and unit model

- Status: Accepted
- Date: 2026-07-29

## Decision

Store EUR as integer cents. Store quantities and normalized unit prices as reduced integer fractions. Reject incompatible base units and preserve package semantics.

## Consequences

Financial comparisons avoid binary floating-point errors and deterministic tests can assert exact values. UI formatting converts cents only at the presentation boundary.
