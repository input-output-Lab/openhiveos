---
title: "Agent Git Discipline — Branching, Commits, PRs, and Merge Gates"
version: "1.0.0"
scope: "all"
status: "active"
review_date: "2026-09-13"
tags:
  - type/sop
  - domain/coding
  - domain/git
---

When I am about to commit, push, or merge code, I follow this SOP. It applies to every agent working in any IO Labs repository.

## Branch Naming

Always create a branch before writing a single line of code. Name the branch using one of three prefixes:

- `feat/<short-description>` — new capability or user-facing behaviour
- `fix/<short-description>` — bug fix, regression correction, copy correction
- `chore/<short-description>` — config change, seed file update, CSS token correction, dependency bump, CI tweak

Use lowercase kebab-case after the prefix. Keep the description under five words. Example: `feat/cron-pause-endpoint`, `fix/task-403-response`, `chore/update-eslint-config`.

## What I May Do Autonomously

I may create a branch, commit to it, and push that branch to the remote at any point during my work. I do not need approval to push to my own branch. I commit atomically — one logical change per commit — and write a commit message in the imperative mood (`Add cron pause endpoint`, not `Added` or `Adding`).

## What I Must Never Do

- **Never push directly to `main`.** Branch protection on `main` is enforced at the GitHub level. Any attempt will be rejected. This is not a guideline — it is a hard constraint.
- **Never self-merge.** I cannot approve or merge my own branch into `main`, regardless of whether the build is passing.
- **Never treat a passing build as validation.** CI green means the code compiles and tests pass. It does not mean the work has been reviewed, accepted, or closed. These are separate gates.

## When a PR Is Required

Open a pull request before any branch merges to `main` if the change touches any of the following:

- A new or modified API endpoint
- A database schema migration
- Any shared abstraction (utilities, middleware, validators, base types)
- A feature with user-facing behaviour

For copy fixes, CSS token corrections, config changes, and seed file updates, a direct branch commit is sufficient. No PR required. The branch still cannot merge to `main` until a human approves.

## The Validation Gate

Before any branch merges to `main`, two conditions must both be true:

1. The task in OpenSquad is in `review` status — not `wip`, not `pending-close`.
2. Scout has reviewed the work against the validation criteria and signed off.

I move the task to `review` when my implementation is complete. I do not move it further. Scout owns the sign-off. The Integrator or a human team member performs the actual merge. I never merge my own work.

## Build Passing ≠ Validated

A green CI build confirms that the code runs. It does not confirm that the right thing was built, that edge cases were covered, that the API contract is correct, or that the acceptance criteria were met. Scout's sign-off is the validation gate. CI is a prerequisite, not a substitute.

---

## Amendment Log

| Version | Date | Author | Change |
|---|---|---|---|
| 1.0.0 | 2026-06-13 | Clarence | Initial version. Formalises decisions from Sprint 12 design review (Elizabeth + Murphy). Surfaces gap: agents committing directly to main without validation gates. |
