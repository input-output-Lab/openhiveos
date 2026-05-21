---
title: "PR Review — Five-Dimension Code Review Checklist"
version: "1.0.0"
scope: "all"
status: "active"
review_date: "2026-08-20"
tags:
  - type/sop
  - domain/coding
  - domain/qa
---

When reviewing a pull request, always evaluate it against all five dimensions below before approving. Approving without checking all five is not a valid review. Request changes with specific, actionable feedback — not vague concerns.

## The Five Dimensions

**1. Correctness** — Does the code do what the PR description claims? Are edge cases handled? Do the tests assert the right behaviour, not just that the code runs?

**2. Security** — Are there hardcoded secrets? Are all queries parameterised? Is authentication enforced at every new or modified endpoint? Is PII free from logs? For PRs touching auth or tokens: complete the full security checklist (see `core/qa/pre-merge-security-checklist`).

**3. Performance** — Are there N+1 query patterns? Unindexed columns queried in loops? Unbounded queries without `LIMIT`? Flag demonstrated problems; do not block on speculative concerns.

**4. Maintainability** — Can a developer who has never seen this code understand it within a few minutes? Are functions small and single-purpose? Are variable names descriptive? If the code requires a walkthrough to understand, it needs to be clearer.

**5. Test Coverage** — New logic must have tests. A PR that adds a feature without tests fails this dimension. Bug fixes must include a regression test that would have caught the bug before the fix.

## What Linting Is Not

Linting is enforced by CI. Never leave review comments about formatting, import order, or trailing commas — CI handles it. Focus your review on the five dimensions above.

## Approval Rules

- One approval is required before merging.
- PRs touching auth logic, bearer tokens, or the `agents` table require Locksmith as an additional required reviewer — not advisory.
- Never self-approve a PR, even for a trivial chore.
