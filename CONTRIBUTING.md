# Contributing

## Workflow

1. Create or update `.agents/specs/<date>-<slug>.md`.
2. Reproduce the behavior with a failing assertion where practical.
3. Make the smallest cohesive change.
4. Run focused tests, then `pnpm quality`.
5. Inspect `git diff`, stage explicit paths, and use a Conventional Commit.
6. Push a feature branch and open a normal pull request.

## Commit format

```text
<type>(<scope>): <imperative summary>
```

Examples: `feat(receipts): validate transactional imports`, `fix(api): await route failures`.

## Pull requests

Describe what changed, why, user impact, tests, risks, migration, rollback, and visual evidence for UI changes. Do not use draft PRs for completed work.
