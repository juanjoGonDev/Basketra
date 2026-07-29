# Repository automation standardization

## Request

Prepare the repository for safe GitHub Actions dependency and cache automation, and open one PR without merging or releasing.

## Evidence

- Default branch: `main`.
- The repository is currently a bootstrap README with no package manifest or existing workflow.
- Adding npm Dependabot now would invent a package-manager contract that does not exist.

## Decision

- Configure GitHub Actions Dependabot only, grouped weekly after a seven-day cooldown.
- Add cache-key-independent cleanup through the repository cache API, with bounded inputs and manual dry-run by default.
- Add the shared Dependabot auto-merge policy without checking out PR code. Production majors remain gated by a current approval from a reviewer with repository write permission.
- Pin introduced Actions by immutable SHA and use read-only defaults.
- Defer npm and release automation until the repository contains an implemented manifest/build/release contract.

## Acceptance

- [x] No speculative npm ecosystem is configured.
- [x] Privileged workflows do not execute pull-request-controlled code.
- [x] External or stale approvals cannot unlock production majors.
- [x] Cache cleanup is safe for an empty repository cache list.
- [x] No release, deployment, or publication is performed.

## Validation

The proposed YAML parsed successfully. Repository contents and default branch were inspected. Future project CI remains the runtime gate once an application stack is committed.

## Risks and rollback

The workflows remain dormant until matching caches or Dependabot PRs exist. Auto-merge and an appropriately scoped token are required for writes. Revert this PR to roll back.

## Delivery

- Branch: `agent/chore-repository-automation`
- Base: `main`
- Merge/release/deploy/publish: not authorized

## Status

Implemented on the task branch; repository settings remain to be verified.
