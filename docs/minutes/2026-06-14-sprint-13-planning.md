# Sprint 13 Planning Notes

**Date:** 2026-06-14  
**Project:** OpenHiveOS  
**Facilitator:** Elizabeth  
**Sprint Goal:** Validate the ClickUp integration end-to-end — smoke test the telemetry path, close the inbound webhook loop, and ship two priority dashboard UX improvements.  
**Sprint Window:** 2026-06-15 (Sat) → 2026-06-21 (Fri) — 7 days  
**Sprint Health Prediction:** 🟢 Confident

---

## Sprint Stories

| Story | Owner | Effort | DoR | Dependencies |
|-------|-------|--------|-----|--------------|
| #1779 — Smoke test: report_usage ingestion | Murphy | S | ✅ | None. Day 1 first task. |
| #1770 — Inbound webhook /webhooks/clickup (HMAC + dedup) | Murphy | M | ✅ | Cooper: CLICKUP_WEBHOOK_SECRET Day 1 |
| #1790 — GET /api/integrations/triage endpoint | Murphy | S | ✅ | None. Unblocks Rocket #1772. |
| #1766 — Retire clickup-mcp-server | Murphy | S | ✅ | Gate: SyncWorker 24h prod + SOP v1.4 merged. Day 4+. |
| #1756 — Projects overview chart on Dashboard home | Rocket | S | ✅ | None. Day 1. |
| #1772 — Triage inbox + external link badges | Rocket | M | ✅ | Murphy #1790 by Day 2 EOD |
| #1791 — sprint-workflow.md v1.4 (retire dual-call pattern) | Clarence | S | ✅* | Murphy confirms SyncWorker path Day 1 AM |
| #1792 — Locksmith HMAC gate on #1770 | Locksmith | S | ✅ | Murphy #1770 PR open |

*DoR cleared in-sprint Day 1 AM — scope written before work starts.

---

## Dependency Sequence

1. **Day 1 (parallel):** Murphy #1779 (no deps) | Rocket #1756 (no deps) | Clarence: scope SOP v1.4 | Cooper: provision CLICKUP_WEBHOOK_SECRET
2. **Day 2:** Murphy #1770 + #1790 (parallel) | Clarence: draft v1.4
3. **Day 3:** Locksmith gate on #1770 PR | Murphy #1770 merges | Rocket #1772 begins
4. **Day 4:** Rocket #1772 complete | Clarence SOP v1.4 merged | SyncWorker 24h confirmed
5. **Day 4+:** Murphy #1766 (all gates clear)

---

## Backlog Refinement List

| Story | What's Missing | Owner | Target Ready |
|-------|---------------|-------|-------------|
| #1757 — Agent full-page detail view | Shadow estimate XL; crowds sprint if included with #1772 | Rocket | Sprint 14 |
| #1752 — Dashboard neo-brutal DS overhaul | L story — needs Spike to break down first | Rocket | S14 Spike |
| #1773 — JIRA adapter full implementation | Gate: ClickUp must run cleanly in prod ≥1 sprint | Murphy | Sprint 15+ |
| #1791 SOP v1.4 | AC scope not written at planning time | Clarence | Day 1 AM (in-sprint) |

---

## PM Intelligence Signals

### Fragility Index
| Area | Zone | Action |
|------|------|--------|
| src/integrations/clickup/ | 🟡 Watch | New code, not yet prod-validated. Peer review required. |
| src/workers/sync-worker.ts | 🟡 Watch | No smoke test yet. Production observation period this sprint. |
| packages/mcp-gateway/src/index.ts | 🟡 Watch | DATA QUALITY GAP comment present. No changes this sprint. |
| Dashboard router + views | 🟢 Stable | 3 P2 bugs fixed in S12. Routing explicit. |

### Velocity (Model 2)
- S12: 8/8 stories, 5-day sprint, 97% utilization, 0 rework.
- No velocity decay. Consistent team execution.
- Correction: 7-day sprint window reduces single-point-of-failure risk.

### Estimation Bias (Model 3) — Private
- #1757 shadow estimate: XL (not L). Excluded from sprint. Deferred to S14.

### Environment Awareness (Model 5)
- Single environment (local OrbStack). No staging slot contention.
- SyncWorker 24h production observation: starts 2026-06-14 post-S12 deploy.

---

## Action Items

- [ ] **Cooper:** Provision `CLICKUP_WEBHOOK_SECRET` in `.env` — **Due: 2026-06-15 (Day 1)**
- [ ] **Clarence:** Write SOP v1.4 scope + AC — **Due: Day 1 AM (2026-06-15)**
- [ ] **Murphy:** Confirm SyncWorker is canonical ClickUp path (for Clarence) — **Due: Day 1 AM**
- [ ] **Murphy:** Confirm /api/agents/:slug field completeness (for #1757 S14 planning) — **Due: Day 3**
- [ ] **Silas:** Confirm #1770 webhook route registered BEFORE /api auth stack in PR review
- [ ] **Elizabeth:** Schedule S13 review ceremony — **Due: 2026-06-21**

---

## Silas Architectural Notes

1. **#1770 route sequencing:** Webhook route at `/webhooks/clickup` must be registered BEFORE `app.use('/api', authMiddleware)`. One-line error exposes route without auth, or incorrectly gates it. Murphy must verify in PR.
2. **SyncWorker observation period:** Task #1766 (retire clickup-mcp-server) gates on SyncWorker producing zero `failed` queue rows during the 24h observation window. Cooper to monitor.
3. **No circular dependencies.** Sequence is achievable in 7 days.
