---
title: "Git Branching Model — GitHub Flow"
version: "1.0.0"
scope: "all"
status: "active"
review_date: "2026-08-20"
tags:
  - type/sop
  - domain/coding
---

When starting any piece of work — feature, bug fix, or chore — always create a short-lived branch from `main`. Never commit directly to `main`. The IO Labs branching model is GitHub Flow. There are no permanent `develop`, `release`, or `hotfix` branches.

## Branch Naming

| Type | Format | Example |
|---|---|---|
| Feature | `feature/short-imperative-description` | `feature/add-sop-ingest-runner` |
| Bug fix | `fix/short-imperative-description` | `fix/search-sops-null-category` |
| Hotfix | `hotfix/short-imperative-description` | `hotfix/boot-crash-empty-sops-table` |
| Chore | `chore/short-imperative-description` | `chore/upgrade-node-22` |

Rules: lowercase, hyphenated, no spaces, maximum 5 words in the descriptor. Do not include ticket numbers in branch names — put those links in the PR description.

## The Core Rule

`main` is always deployable. Every merge to `main` represents a state that could go to production. A PR that fails tests, lint, or security gates does not merge under any circumstance — not even for a hotfix.

## Merging

Always use **squash merge** when merging a PR into `main`. This produces one commit per feature, keeping history linear. The squash commit message must follow Conventional Commits — do not accept GitHub's auto-generated squash message.

After merge, delete the branch. Stale branches are not kept.

## Hotfixes

A hotfix follows the same process as any other branch. The only difference is that a hotfix PR is treated as the highest-priority review. Tag the Technical Lead immediately on opening. CI gates still apply — they cannot be bypassed.
