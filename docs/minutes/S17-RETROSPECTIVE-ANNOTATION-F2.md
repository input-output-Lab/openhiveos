---
title: "S17 Retrospective — Audit Annotation F2: Task 2550 Nova Dual-Gate"
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

*One-sentence purpose: permanently record the task-2550 dual-gate (Nova as both reviewer and approver on 2026-11-02), what enforcement existed at the time, what prevents the exact pattern today, and which part remains policy-only.*

---

## The finding (S17 pre-sprint audit, F2)

Task **2550** (S17-AGT-02: canonical hour-estimation skill) shows Nova in both
gate roles on **2026-11-02**:

| Time (UTC) | Transition | Changed by |
|---|---|---|
| 06:34 | todo → wip | elizabeth |
| 06:42 | wip → review | elizabeth |
| 07:03 | **review → pending-close** | **nova** (reviewer role) |
| 09:19 | **pending-close → done** | **nova** (approver role) |

This is a **letter violation** of the never-self-approve rule: the agent who
gated the review also approved the closure, two hours apart, with no second
identity between the gates.

## Why it happened

The dual gate occurred **before** the full state-machine enforcement landed
(PR #28 / task #2555, merged later that day). At 07:03–09:19 UTC the
transition layer had no role gating at all — any caller could execute any
transition, so Nova executing both steps was operationally normal for the era,
even though it violated the *intended* separation the moment #28 was being
built to enforce.

A second factor specific to 2550: as an Elizabeth-owned task, its resolved
approver **is Nova** (D5: Elizabeth's work is approved by Nova, since
Elizabeth is the assignee/owner and cannot approve her own). So the approver
half of the dual gate was by-design. The violation is that the *reviewer* half
was also Nova — the reviewer and approver should be different identities.

## What prevents recurrence — the honest split

**Enforced by code (PR #28, `task-transitions.ts`):**

- Self-review blocked: an assignee can never be the resolved reviewer of their
  own submission (P2).
- `pending-close → done` is approver-only: the approver is resolved
  deterministically (Elizabeth's tasks → Nova; everything else → Elizabeth),
  and no other role can execute it.
- The `system` identity cannot act via `update_task` at all.
- Fail-closed reviewer resolution: explicit reviewer stamp → domain default →
  project owner; never "the caller, by omission."

**Policy-only (the gap this annotation must state plainly):**

For an Elizabeth-owned task **explicitly stamped with Nova as reviewer**, Nova
resolving as reviewer for `review → pending-close` and as approver for
`pending-close → done` is **still permitted by code** — nothing in
`resolveActorRole` compares the resolved reviewer against the resolved
approver. The 2550 pattern (same identity in both gates) therefore cannot
recur *by accident* the way it did pre-#28, but a *deliberate* stamped dual
gate is prevented by the D5 convention ("Nova no longer gates tasks she
reviewed; reviewer must differ from approver") — a policy recorded in #2555's
spec and this retro, not a runtime check.

## Recommended follow-up (for Scout's threshold review / Murphy's backlog)

Add a code-level guard: if `resolveReviewer(ctx) === resolveApprover(ctx)` and
the caller is that identity, reject `review → pending-close` (or
`pending-close → done`) with "reviewer and approver must be different
identities." This converts the D5 convention into enforcement, closing the
letter-violation class permanently. Suggested as a small task at S19 planning;
not executed here (2688 is an acknowledgment item).

## Actions taken

1. **This annotation** — permanent record, per the audit mandate.
2. **No history mutation** — the 2550 rows are untouched; the gap is
   acknowledged, not rewritten.
3. **Follow-up proposed** — reviewer ≠ approver code guard (above), for S19
   planning.

## Residual risk

Low-moderate: accidental dual-gates are structurally blocked; deliberate
dual-gates are policy-prevented only. Mitigation is visibility — any future
dual gate is trivially detectable in `task_status_history` (same `changed_by`
on consecutive gate transitions), and the audit library could flag it (same
mechanism suggested for the F1 `system:sql` tripwire).

## Owner & review date

Owner: Elizabeth. Review: 2027-05-09 (S19 retro). Source: S17 pre-sprint audit
F2 (Murphy, 2026-11-02, memory 3396); verified 2026-11-09 against
`task_status_history` and `task-transitions.ts` by Clarence.
