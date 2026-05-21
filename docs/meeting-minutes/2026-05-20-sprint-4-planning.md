---
title: "OpenHiveOS — Sprint 4 Planning — Kick-Off"
date: 2026-05-20
tags: [projects/openhiveos, sprint-planning, sprint-4]
---

# OpenHiveOS — Sprint 4 Planning — Kick-Off

**Date:** 2026-05-20  
**Type:** Sprint Planning  
**Facilitator:** Elizabeth (PM)  
**Sprint Window:** 2026-05-20 → 2026-06-03

---

## Attendees

- Richo — Founder
- Elizabeth — Project Manager (Facilitator)
- Murphy — Backend
- Silas — Architect
- Locksmith — Security
- Cooper — DevOps
- Clarence — Documentation

---

## Agenda

1. Sprint 3 retrospective (brief)
2. Sprint 4 goal and scope confirmation
3. ARCH-011 architecture session (Silas)
4. Seat-by-seat feasibility review
5. Richo decisions: soft delete, caller-scoped sprints, Dockerfile timing
6. Sprint 4 task board creation and kick-off

---

## Sprint 3 Retrospective

Result: **Clean close. All Coordination Utilities stories done.**

SEC-21 through SEC-25 all cleared by Locksmith. `advance_sprint` semantics confirmed in production — `MAX(sprint_number)+1` with `UNIQUE(project_id, sprint_number)` race guard working correctly. No rework items. Sprint 3 formally closed.

---

## Sprint 4 Goal

> **Build the Cron Utilities registration layer — `create_cron`, `update_cron`, `query_crons`, `delete_cron` — plus `query_sprints` and health endpoint schema verification. This completes the v0.1.0 feature set and prepares OpenHiveOS for a first public release.**

---

## ARCH-011 Architecture Session

Silas presented the Cron Utilities schema proposal. Three decisions raised for Richo:

### D1 — Soft delete vs. hard delete

**Decision B (Richo): Soft delete only.**

`delete_cron` sets `status = 'deleted'`. No row is ever physically removed from the `crons` table. Rationale: cron audit trail is required for post-incident review. The cron worker needs to know a schedule existed, when it last ran, and when it was removed. Hard delete destroys that record.

Enforcement: no `DELETE FROM crons` statement appears anywhere in the codebase. Locksmith (SEC-29) confirmed.

### D2 — Caller-scoped `query_sprints`

**Decision A (Richo): Server-side caller scoping.**

`query_sprints` automatically filters results to projects owned by the calling agent. The server injects `owner_agent_slug` — the caller cannot override it. No agent can read another agent's sprint history. Consistent with the ownership model applied to `query_tasks`.

### D3 — Dockerfile timing

**Decision: Defer to Sprint 5.**

A Sprint 4 Dockerfile is out of scope. Current capacity is fully committed to the Cron Utilities tools, security review, and v0.1.0 packaging. Docker Compose productization is formally deferred. No timeline commitment made.

---

## Security Pre-flight — Locksmith

Locksmith ran pre-flight before sprint kick-off. One blocker identified:

**F-1 (SEC-28): No cron parser installed.**

The SEC-28 condition requires server-side validation of cron expressions before any expression is written to the database. No cron parsing library was present. Blocker cleared by Murphy before S4-02 start: `cron-parser@^4.9.0` installed. Zero CVEs. ESM interop pattern confirmed (`import cronParser from 'cron-parser'`; default import due to CJS module format).

---

## Sprint 4 Task Board

| Task | Description | Owner | Est. |
|------|-------------|-------|------|
| S4-00 | ARCH-011 — Cron Utilities Schema ADR | Silas | XS |
| S4-01 | Migration 003 — `crons` table | Murphy | S |
| S4-02 | Cron tools × 4: `create_cron`, `update_cron`, `query_crons`, `delete_cron` | Murphy | M |
| S4-03 | `query_sprints` tool | Murphy | S |
| S4-04 | Apply migration 003 + health.ts schema check | Cooper | XS |
| S4-05 | CI migration validation — 9-table + FK verify | Cooper | XS |
| S4-06 | SEC review — nine-point Cron Utilities gate | Locksmith | S |
| S4-07 | v0.1.0 release packaging — branch, commit, health check | Murphy + Cooper | M |
| S4-08 | Documentation gate — glossary, README, CHANGELOG, cron reference | Clarence | S |

---

## Key Decisions

1. **Sprint 4 goal confirmed.** Cron Utilities registration layer + v0.1.0 release packaging. The cron worker execution tier is out of scope — Sprint 5. — **Owner: Elizabeth**

2. **D1 — Soft delete (Richo).** `delete_cron` marks `status = 'deleted'`. No hard deletes. Audit trail preserved permanently. — **Owner: Richo**

3. **D2 — Caller-scoped `query_sprints` (Richo).** Server injects `owner_agent_slug`. No agent reads another agent's sprint history. — **Owner: Richo**

4. **D3 — Dockerfile deferred (Richo).** Docker Compose productization moves to Sprint 5. No capacity in Sprint 4. — **Owner: Richo**

5. **ARCH-011 accepted.** Cron table schema with SEC-26 through SEC-30 binding conditions is the authoritative design. — **Owner: Silas**

6. **`tool_name` allowlist (SEC-26).** `create_cron` and `update_cron` must reject any `tool_name` not in the canonical allowlist in `src/utilities/tool-registry.ts`. Compile-time exhaustive check required. — **Owner: Murphy + Locksmith**

7. **Payload controls (SEC-27).** Cron `payload` JSONB enforces: 16 KB size cap, 5-level nesting cap, plain object type guard. — **Owner: Murphy + Locksmith**

8. **v0.1.0 is a registration-only release.** The release is complete when the health endpoint returns `{status:'ok', schema:'ok', db:'connected', version:'0.1.0'}`. The cron worker ships in Sprint 5. — **Owner: Murphy + Cooper**

---

## Definition of Done — Sprint 4

- [ ] All 8 task stories marked DONE in OpenSquad
- [ ] `npm run lint` — 0 errors
- [ ] `npm run typecheck` — 0 errors
- [ ] `npm audit` — 0 CVEs
- [ ] `GET /health` → HTTP 200 `{status:'ok', schema:'ok', db:'connected', version:'0.1.0'}`
- [ ] Locksmith nine-point gate — all nine conditions PASS
- [ ] CHANGELOG.md present with v0.1.0 entry
- [ ] `docs/cron-utilities-reference.md` complete
- [ ] Glossary updated with cron terms
- [ ] `docs/README.md` updated with Sprint 4 additions

---

## Sprint 5 Named Items (Backlog)

The following were raised during Sprint 4 planning but are out of scope:

- **Cron worker execution layer** — the engine that runs active crons on schedule
- **Dockerfile + Docker Compose** — D3 deferral
- `queryCronsSchema.strict()` — Locksmith O-1 (non-blocking, logged for Sprint 5)
- `query_crons` cross-agent enumeration gap — ARCH-011 Tech Debt #2
- `update_task` assignee permission model — named debt from Sprint 3

---

*Minutes recorded by Clarence. Reviewed: 2026-05-21.*
