# Price confidence

Every external offer or price observation must retain evidence, observation timestamp, stock state, shipping, conditions, and confidence.

Suggested confidence interpretation:

- `0.95–1.00`: user-confirmed receipt or official current listing;
- `0.80–0.94`: reliable current source with complete package semantics;
- `0.60–0.79`: incomplete conditions or uncertain product match;
- below `0.60`: review required and unsuitable for silent recommendation.

Reading cached data never refreshes `observedAt`. Stale prices remain stale. Confidence does not replace evidence and does not permit semantically invalid unit comparison.
