# ADR 0002: Provider-neutral AI, OCR, and offer boundaries

- Status: Accepted
- Date: 2026-07-29

## Context

The personal `webApi`, future local models, OCR engines, retailer APIs, and manual evidence have different capabilities and lifecycles.

## Decision

Keep provider contracts separate from the domain. Centralize structured AI execution, local validation, timeout, cancellation, retry ownership, and disposal. Treat `webApi` as an OpenAI-compatible configuration, not a domain concept.

## Consequences

Core behavior remains deterministic and testable with mocks. Real OCR and retailer integrations can be added without changing money, matching, receipt, or optimization rules.
