---
title: "S17 Retrospective — Audit Annotation F1: Unattributable Bulk-SQL Closures"
date: 2026-11-09
updated: 2026-11-09
author: "Clarence"
owner: "Elizabeth"
status: final
tags:
  - type/retrospective
  - project/openhiveos
  - domain/process
  - audience/all
review_date: 2027-05-09
related:
  - "[[ARCH-027-task-lifecycle-v2-and-usage-v2]]"
---

*One-sentence purpose: permanently record what happened on 2026-10-31 when six tasks were closed by unattributable bulk SQL, why it mattered, what was verified afterward, and why it cannot recur.*

---

## The finding (S17 pre-sprint audit, F1)

Six shipped S17 tasks were moved `pending-close → done` by an actor recorded as
**`system:sql`** at the identical timestamp **2026-10-31 18:12:52**:

| Task | Title | Transition |
|---|---|---|
| 2551 | S17-BE-02: Aging/escalation cron | pending-close → done |
| 2552 | S17-BE-04: Active-time → auto worklogs | pending-close → done |
| 2553 | S17-DB-01: Enrich llm_usage + model registry | pending-close → done |
| 2554 | S17-SEC-01: SEC-C9 v2 — versioned price list | pending-close → done |
| 2636 | S17-OPS-04: MCP_GATEWAY_AUTH_DISABLED investigation | pending-close → done |
| 2640 | S17-SPIKE-01: Agent identity spike | pending-close → done |

**The approver identity for these six closures is not attributable from the
record.** The audit trail shows *what* happened and *when*, but not *who*.

## Why it happened

The closures pre-date the S17 state-machine enforcement (PR #28, task #2555)
which added reviewer/approver role checks to `update_task`. At the time, the
pending-close → done transition had no role gate, so a single bulk SQL
statement (run outside `withActor()`, hence the `system:sql` default) could
close all six tasks at once. The bulk closure was itself a cleanup action —
sweeping six tasks that had already passed review — but it bypassed the
gate-approval chain and left no human-readable attribution.

## What was verified afterward

The **S17 validation sweep (Elizabeth, 2026-11-02)** independently confirmed:

1. All 22 S17 tasks had complete gate chains recorded (todo → wip → review →
   pending-close) — the *approvals* were attributable even though these six
   *finalizations* were not. The bulk SQL only did the last step.
2. Every deliverable was verified against ground truth: merged commits on
   main, migrations applied live, cron states correct, tools registered.
3. The transition history was never mutated — this annotation is additive.

## Why it cannot recur

Post-PR#28 (#2555, merged 2026-11-02), the state machine structurally blocks
this path:

- `pending-close → done` requires the **approver** role (Nova, or Elizabeth's
  tasks approved by Elizabeth) — a role, not an env var.
- The `system` row for that transition fires **only** through
  `assertSystemTransition()` (cron auto-close, 30-day rule) which rejects
  `update_task` input outright — verified in `task-transitions.ts`.
- Direct bulk SQL now lands as `system:sql` **and** the transition layer runs
  inside `withActor()` everywhere sanctioned writes happen — unattributed
  writes are visible as anomalies (and the new `audit_hive` invariant library
  flags unattributable closure patterns).

## Recurrence acknowledgment (S18, 2026-11-09)

The same `system:sql` pattern resurfaced **once**: the S18 done-batch
(2026-11-09 10:24:38, tasks 2560/2561/2562/2564/2565/2566/2567) was executed
via SQL rather than Nova's approver token (operator-confirmed in session). The full chain is
visible in `task_status_history` (Elizabeth review → pending-close at
10:18–10:20, done at 10:24), so integrity held — but the attribution pattern
repeated. Lesson recorded: batch closures should run through the approver's
MCP token, or at minimum through `withActor('nova')`, so the record names the
actor.

## Actions taken

1. **This annotation** — permanent record (docs + memory), per the audit's
   documentation/acknowledgment mandate.
2. **No history mutation** — `task_status_history` rows are untouched, as
   required. The gap is acknowledged, not papered over.
3. **Structural fix already live** — PR #28's role gates + `withActor()`
   attribution.
4. **Retro scope extended** — the S18 done-batch recurrence (above) is folded
   into this annotation and the 2687 closure note, so the S19 retrospective
   sees both occurrences in one place.

## Residual risk

Low. The unattributable path is closed structurally; the remaining exposure is
a human choosing raw SQL over the sanctioned tools — detectable after the fact
via `system:sql` rows, preventable only by convention (recorded above).

## Owner & review date

Owner: Elizabeth. Review: 2027-05-09 (S19 retro). Source: S17 pre-sprint audit
F1 (Murphy, 2026-11-02, memory 3396); verified 2026-11-09 against
`task_status_history` by Clarence.
