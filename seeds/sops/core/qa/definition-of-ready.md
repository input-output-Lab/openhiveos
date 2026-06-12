---
title: "Definition of Ready — Sprint Story Intake Gate"
version: "1.0.0"
scope: "all"
status: "active"
owner: "elizabeth"
review_date: "2026-09-12"
tags:
  - type/sop
  - domain/qa
  - domain/coding
  - project/openhiveos
---

A story is **Ready** when every condition below is met. Stories that fail any condition do not enter sprint planning. No exceptions.

This standard applies to all story types: features, bugs, tech-debt, and spikes.

---

## The Five Definition of Ready Conditions

**1. User Story**
Written in "As a / I want / So that" format with a clear user role and outcome. Tech-debt and infrastructure stories may substitute a business justification sentence in place of a user story.

**2. Acceptance Criteria**
Minimum three acceptance criteria in Given/When/Then (Gherkin) format. Must cover:
- The happy path
- At least one edge case (null value, empty state, boundary condition)
- At least one error state (network failure, invalid input, not found)

**3. Hour Estimate**
Signed-off estimate present with confidence level (High/Medium/Low) and billing envelope (minimum/maximum hours). No story enters the sprint without an estimate. If a story cannot be estimated, convert it to a Spike first.

**4. Dependencies Identified**
All upstream dependencies named and either:
- Resolved (dependency shipped and available), or
- Confirmed resolution date within the sprint window

Unresolved dependencies without a confirmed date = Blocked, not Ready.

**5. No Open Blockers**
No open blocker that would prevent a developer from starting work immediately after sprint kick-off.

---

## Security Gate — Tier Classification (Added 2026-06-12)

**This condition was added following a process gap identified in Sprint 11 (S11-BE-00) where a field allowlist fix was caught during self-review REWORK rather than at the formal Locksmith gate.**

Every story that touches data write operations must be classified before entering the sprint:

| Tier | Trigger | Locksmith Gate |
|------|---------|----------------|
| **Tier 1** | Read-only, no auth surface changes | No gate required |
| **Tier 2** | Writes to non-sensitive tables, no auth changes | Locksmith advisory review — tag Locksmith in the PR description; feedback is non-blocking but must be acknowledged before merge |
| **Tier 3** | Auth logic, bearer tokens, `agents` table, any new HTTP/MCP write endpoint | **Locksmith required reviewer — gate at PR-OPEN** |

**Tier 3 gate rules:**
- Locksmith must be tagged **when the PR is opened** — not when it is "otherwise ready"
- Locksmith must explicitly sign off before merge — not advisory, not optional
- Self-certified security fixes (e.g. applied during a REWORK loop) are not a substitute for the Locksmith gate
- If a PR is opened without Locksmith tagging and it is Tier 3, it is blocked immediately — Murphy or the opening engineer cannot proceed to merge

**Assigning the tier is the responsibility of the story author.** If the tier is unclear, default to Tier 3 and ask Locksmith to downgrade. Never assume Tier 1.

For Tier 3 PRs, both this checklist and the [Pre-Merge Security Checklist](../qa/pre-merge-security-checklist.md) apply. Complete both before requesting a merge.

---

## Grooming Checklist

Before Elizabeth marks a story as Ready in the backlog:

- [ ] User story or business justification written
- [ ] Minimum 3 AC (happy path + edge case + error state)
- [ ] Hour estimate present and signed off
- [ ] All dependencies identified and resolved or dated
- [ ] No open blockers
- [ ] Security tier classified (Tier 1/2/3)
- [ ] If Tier 3: Locksmith tagged in story description before sprint planning begins
- [ ] If Tier 3 and data write: parameterized queries and field allowlist noted in AC

---

## How This Applies to the Issues List

Stories raised from the Issues List (IDS — Identify, Discuss, Solve) during an L10 follow the same gate. A blocker that gets solved in the same meeting it is raised does not need a formal DoR check. A blocker that becomes a task or story does.

---

## Changelog

| Date | Change | Author |
|------|--------|--------|
| 2026-06-12 | Initial document — codifies the security tier system added after S11-BE-00 process gap | Elizabeth |
| 2026-06-12 | Clarence review: added owner field, defined Tier 2 advisory behaviour, cross-reference to pre-merge-security-checklist, defined IDS abbreviation on first use | Clarence |
