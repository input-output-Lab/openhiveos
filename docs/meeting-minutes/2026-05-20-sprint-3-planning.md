---
title: "OpenHiveOS — Sprint 3 Planning — Kick-Off"
date: 2026-05-20
tags: [projects/openhiveos, sprint-planning, sprint-3]
---

# OpenHiveOS — Sprint 3 Planning — Kick-Off

**Date:** 2026-05-20
**Type:** Sprint Planning
**Facilitator:** Elizabeth (PM)
**Sprint Window:** 2026-05-21 → 2026-06-03

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

1. Sprint 2 retrospective (brief)
2. Sprint 3 goal and scope confirmation
3. Seat-by-seat feasibility review
4. ARCH-010 architecture session (Silas + Murphy)
5. Richo decisions: `advance_sprint` semantics and sprint goal history
6. Sprint 3 task board creation and kick-off

---

## Sprint 2 Retrospective

Result: **17/17 tasks DONE. Clean close.**

No blockers to carry forward. No rework items. Sprint 2 is formally closed.

---

## Sprint 3 Goal

> **Extract and ship the Coordination Utilities tier — projects, tasks, and sprint management — into OpenHiveOS v0.1. This completes the v0.1 feature set.**

---

## Sprint 3 Task Board

| Task | Description | Owner | Status |
|------|-------------|-------|--------|
| S3-00 | ARCH-010 — Coordination Utilities Schema | Silas | DONE |
| S3-01 | Migration 002 — Coordination Utilities schema | Murphy | TODO |
| S3-02 | Project utilities (`create_project`, `query_projects`) | Murphy | TODO |
| S3-03 | Task + Sprint utilities (`create_task`, `query_tasks`, `update_task`, `advance_sprint`) | Murphy | TODO |
| S3-04 | Apply migration 002 to dev environment | Cooper | TODO |
| S3-05 | Health endpoint verify (all utilities registered) | Cooper | TODO |
| S3-06 | CI job — migration smoke test | Cooper | TODO |
| S3-07 | SEC review batch 1 — Project + Task utilities | Locksmith | TODO |
| S3-08 | SEC review batch 2 — Sprint utilities + `advance_sprint` | Locksmith | TODO |
| S3-09 | Documentation gate — glossary + README Architecture section | Clarence | TODO |
| S3-10 | Sprint 3 planning meeting minutes | Clarence | TODO |

---

## Key Decisions

1. **Sprint 3 goal confirmed.** Extract and ship the Coordination Utilities tier — projects, tasks, and sprint management — into OpenHiveOS v0.1. This completes the v0.1 feature set. — **Owner: Elizabeth**

2. **Cron utilities deferred to Sprint 4.** `create_cron`, `update_cron`, `query_crons`, and `delete_cron` are out of scope for Sprint 3. Capacity decision: shadow estimate for 12 tools ran approximately 50% over capacity. — **Owner: Elizabeth**

3. **ARCH-010 accepted.** Three-table schema (`projects`, `tasks`, `sprints`) is the binding design. SEC-21 through SEC-25 are binding controls for all Coordination Utility handlers. — **Owner: Silas**

4. **`advance_sprint` semantics — Decision B (Richo).** Auto-compute `MAX(sprint_number)+1`. `UNIQUE(project_id, sprint_number)` is the race guard. The caller does not supply a sprint number. — **Owner: Richo**

5. **Sprint goal history — Decision A (Richo).** The `sprints` table captures history by row. No `query_sprints` utility is in scope for Sprint 3. This is named debt, deferred to Sprint 4. — **Owner: Richo**

6. **Schema deviation caught by Silas.** `memories.task_id` and `thoughts.task_id` are declared as `INT` in `001_init.sql`. They must be promoted to `BIGINT` before FK constraints can land in migration 002. Murphy must execute the `ALTER TABLE` promotions as the first step in migration 002. — **Owner: Silas / Murphy**

7. **`advance_sprint` must handle PostgreSQL error code `23505`.** The handler must catch the unique violation and return a retryable error — not a 500. — **Owner: Murphy**

8. **`create_task` requires a pre-flight ownership `SELECT` before `INSERT`.** A subquery inside the `INSERT` is not acceptable. The explicit `SELECT` is required for SEC-21 compliance and auditability. — **Owner: Murphy**

9. **S3-09 (documentation) is a merge gate.** S3-02 and S3-03 do not merge to `main` until the glossary updates and the README Architecture section are complete. — **Owner: Clarence / Elizabeth**

10. **Locksmith SEC reviews formally scheduled.** S3-07 on Day 6 (May 26), S3-08 on Day 10 (May 30). These are formal calendar entries — not async asks. — **Owner: Elizabeth / Locksmith**

---

## Action Items

- [ ] Begin S3-01 (migration 002) — Murphy — Due: May 22
- [ ] S3-05 (health endpoint verify) — starts Day 1, no dependencies — Cooper — Due: May 22
- [ ] S3-06 (CI job) — starts when migration 002 SQL file exists — Cooper — Due: May 23
- [ ] S3-04 (apply migration to dev) — Cooper — Due: May 23
- [ ] Review ARCH-010 schema (simultaneously with filing, not after) — Locksmith — Due: May 22
- [ ] S3-10 meeting minutes — Clarence — Due: May 20 (today)
- [ ] S3-09 documentation gate — gates on Murphy's final tool names — Clarence — Due: Sprint close (Jun 3)
- [ ] Update OpenSquad sprint board with Sprint 3 tasks — Elizabeth — Due: May 20 (today)
- [ ] Store sprint goal in OpenSquad memory — Elizabeth — Due: May 20 (today)
- [ ] Confirm Locksmith SEC review dates formally on calendar — Elizabeth — Due: May 20 (today)

---

## Notes

- Cron utilities scope reduction was agreed without objection. Shadow estimate data was sufficient to justify the cut without a full re-estimate session.
- The `INT` → `BIGINT` promotion (Decision 6) was caught during the ARCH-010 review session before any migration was written. No rework cost. Silas to file a quick-format ARCH record noting the promotion as a binding constraint on migration 002.
- The merge gate for S3-09 (Decision 9) formalises documentation as a first-class exit criterion for this sprint — consistent with the Definition of Done established in Sprint 1.

---

*Minutes authored by Clarence. Next meeting: Sprint 3 mid-point check-in (TBD by Elizabeth).*
