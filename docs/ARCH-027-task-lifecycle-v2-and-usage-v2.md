---
title: "ARCH-027 — Task Lifecycle v2 (States, Roles, Aging) + Usage Capture v2 (SEC-C9 revision)"
date: 2026-11-09
updated: 2026-11-09
author: "Clarence"
owner: "Silas (lifecycle) / Murphy (usage capture)"
status: draft
tags:
  - type/architecture
  - project/openhiveos
  - domain/backend
  - audience/technical
review_date: 2027-02-09
doc_id: "ARCH-027"
supersedes:
  - "[[ARCH-023-pending-close-task-state-machine]]"
  - "[[ARCH-015-llm-usage-tracking]] (v2 sections)"
related:
  - "[[ARCH-019-sprint-9-api-surface]]"
  - "[[ARCH-024-triage-integration]]"
---

*This ADR supersedes ARCH-023 and the state-machine portions of ARCH-015. It records the S16–S18 evolution: the seven-state lifecycle (triage→todo→wip→review→pending-close→done, plus rework), the reviewer/approver role resolution with the fail-closed domain defaults (P2 ruling), the aging policy (7/14/30), the resolution field, and the usage-capture v2 architecture (S18-BE-01 ingestion + SEC-C9 v2 model-registry revision). Status: DRAFT pending owner review (Silas, Murphy).*

---

## ADR — ARCH-027: Task Lifecycle v2 + Usage Capture v2

**Date:** 2026-11-09
**Project:** openhiveos
**Status:** Draft — pending owner review
**Decision Owners:** Silas (lifecycle rules), Murphy (usage capture implementation)
**Author:** Clarence (S18-DOC-01, #2568)

---

## Part 1 — Task Lifecycle v2 (supersedes ARCH-023)

### Context (what changed since ARCH-023)

ARCH-023 (2026-06-12) introduced `pending-close` as a first-class state with an
M3 handler-level gate. S16–S18 added: `triage` (inbound integration state,
019), `rework` (aging cron reroute), the `resolution` column (014), the
reviewer/approver role state machine (S16-BE-01/`task-transitions.ts`, S17-BE-01
#2555), per-domain reviewer defaults (P2 fail-closed ruling), and the 7/14/30
aging policy (S17-BE-02 #2551).

### Decision

**States (7):** `triage → todo → wip → review → pending-close → done`, with
`rework` as a corrective loop entered from review.

**Transition table (enforced by `task-transitions.ts` + DB trigger 024):**

| From | To | Required role |
|---|---|---|
| triage | todo | system (inbound processor) |
| todo | wip | assignee or owner |
| wip | review | assignee |
| review | pending-close | **reviewer only** |
| review | rework | reviewer only |
| review | done | reviewer only (legacy direct path) |
| wip | todo | assignee (demotion) |
| pending-close | done | approver only |
| pending-close | rework | approver only |

**Role resolution (P2 fail-closed ruling, 2026-10-29):**

- `reviewer` = `tasks.reviewer_agent_slug` → else domain default → else project
  owner.
- Domain defaults (`REVIEWER_DOMAIN_DEFAULTS`): `arch → silas`,
  `security → locksmith`, `qa → scout`, `docs → clarence`, else → project owner.
- `approver` = Nova (default approver), except Elizabeth-authored tasks where
  Nova approves.
- An assignee can never hold the reviewer role on their own work (integrity —
  a reviewer rubber-stamping their own submission is the failure ARCH-023's
  gate existed to prevent).

**Aging policy (S17-BE-02):** review 7d → ping reviewer (follow-up task, dedupe
key `aging_ping_7d`); review 14d → escalate to owner; review ≥14d unassigned →
rework reroute; pending-close 30d → auto-close with `resolution='auto_closed'`.
Recursion guard: cron-created follow-ups carry `aging_followup` and are never
re-aged. Exact-key dedupe (NOT prefix) — documented after the integration-test
bug where prefix matching made escalation unreachable.

**Resolution column (014):** tasks carry `resolution` (e.g. `auto_closed`,
`shipped`, `dup`) — surfaced on the board and in reports; set by the closing
transition, not hand-typed.

**Attribution (024 trigger):** every status transition writes
`task_status_history` with `changed_by` = `hive.actor` (set via `withActor()`;
regex-validated slug). Direct SQL without an actor records `system:sql` — a
known audit smell tracked as retro finding F1 (2687). Lifecycle audit
requirement: gate transitions should be attributable to a named agent.

### Consequences

- ARCH-023's M3 gate survives as the handler-level enforcement inside
  `updateTask`; the v2 table adds the role layer on top.
- The GitHub PR-merge webhook (S18-BE-02 #2559) auto-transitions matching
  tasks (by `github_pr_url`) review → pending-close with
  `changed_by='system:github-webhook'` — merges are review evidence by
  governance ruling.
- `triage` is inbound-processor-only and excluded from report status mixes.

---

## Part 2 — Usage Capture v2 (ARCH-015 v2 sections + SEC-C9 revision)

### Context

ARCH-015 v1 chose Option C (client-reported usage): Bridge/clients compute
cost and POST exact tokens+cost; server-side pricing table excluded (SEC-C9
v1: no `llm_model_pricing`, 422 on missing `cost_usd`).

S18 superseded the cost-model half: **S17-DB-01 (#2553) introduced the
`llm_models` registry with aliases and the versioned price list (SEC-C9 v2,
from S17-SEC-01 #2554)** — server-side cost estimation now resolves via
registry lookup (`v_cost_by_task`, `llm_model_prices` single-current
constraint) instead of trusting client-reported cost alone. **S18-BE-01
(#2564) added VS Code session-store ingestion** (usage collected by the
harness, not the model).

### Decision (v2)

1. **Capture surfaces:** Bridge `report_usage` (exact), gateway gateway-log
   enrichment (session_id/task_id attribution), VS Code session-store
   ingestion script (`src/scripts/usage-collector/` → `ingest-usage.ts`),
   daily LaunchAgent at 03:15.
2. **SEC-C9 v2:** cost source of truth = `llm_models` registry +
   `llm_model_prices` versioned rows (single-current constraint). Client
   `cost_usd` is a claim, reconciled against registry pricing; unknown models
   fall to `cost_source = unknown` and are flagged by the audit library
   (`tool.error-rate-p95` sibling check on data freshness).
3. **Attribution columns** (026): `session_id`, `task_id`, `project_id`,
   `client_surface`, `actor_type`, `arg_keys`, `args_hash` on
   `tool_invocations` — per-call cost rolls up to tasks/projects via
   `v_cost_by_task`.
4. **Privacy boundary:** arg_keys/args_hash only — never arg values.

### Consequences

- ARCH-015 v1's "pricing table is dead code" statement is REVOKED as of
  SEC-C9 v2; the registry is now the cost source of truth.
- Budget views (#2560) and reports (#2562/2566) read from these tables —
  coverage labels in every report section name the source.
- Worklog derivation (`worklog-derive`) requires the 026 enrichment;
  sessions without attribution produce zero worklog rows (known data gap,
  documented in the reports SOP).

---

## Supersession map

| Superseded | By this ADR | Survives |
|---|---|---|
| ARCH-023 (pending-close introduction + M3 gate) | Part 1 state table + role layer | M3 handler gate (still enforced in updateTask) |
| ARCH-015 SEC-C9 v1 (no pricing table, client-cost-only) | Part 2 SEC-C9 v2 | Client-reported usage transport (Option C transport model) |

---

## Version history

| Version | Date | Author | Change |
|---|---|---|---|
| v0.1 draft | 2026-11-09 | Clarence (S18-DOC-01, #2568) | Initial draft — lifecycle v2 + usage v2, superseding ARCH-023 + ARCH-015 v2 sections. DRAFT pending Silas/Murphy owner review. |
