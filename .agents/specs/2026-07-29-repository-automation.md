# Repository automation standardization

## Request

Prepare the repository for safe GitHub Actions dependency and cache automation, and open one PR without merging or releasing.

## Evidence

- Default branch: `main`.
- The repository is currently a bootstrap README with no package manifest or existing workflow.
- Adding npm Dependabot now would invent a package-manager contract that does not exist.
- Dependabot-triggered `pull_request_target` workflows receive a read-only token and no secrets, so privileged Dependabot automation must not depend on repository secrets.

## Decision

- Configure GitHub Actions Dependabot only, grouped weekly after a seven-day cooldown.
- Use `pull_request` plus the repository-scoped `GITHUB_TOKEN` for Dependabot approval, labels, and auto-merge; no PR code is checked out.
- Require a current write-permission maintainer approval for production majors, bound to the current head SHA.
- Use the scheduled default-branch workflow and `GITHUB_TOKEN` for required-QA branch updates and auto-merge.
- Add cache-key-independent cleanup through the repository cache API, with bounded inputs and manual dry-run by default.
- Defer npm and release automation until the repository contains an implemented manifest/build/release contract.

## Acceptance

- [x] No speculative npm ecosystem is configured.
- [x] No privileged workflow checks out pull-request-controlled code.
- [x] External or stale approvals cannot unlock production majors.
- [x] Cache cleanup is safe for an empty repository cache list.
- [x] No new repository secret or variable is required.
- [x] No release, deployment, or publication is performed.

## Validation

The proposed YAML parsed successfully. Repository contents and default branch were inspected. Future project CI remains the runtime gate once an application stack is committed.

## Repository settings

Enable repository auto-merge and `Allow GitHub Actions to create and approve pull requests` before dependency PR automation becomes active.

## Risks and rollback

The workflows remain dormant until matching caches or Dependabot PRs exist. The workflows cannot approve or queue pull requests if the repository settings above are disabled. Revert this PR to roll back.

## Delivery

- Branch: `agent/chore-repository-automation`
- Base: `main`
- Merge/release/deploy/publish: not authorized

## Status

Implemented on the task branch; repository settings remain to be verified.
