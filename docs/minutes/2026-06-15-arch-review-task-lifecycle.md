# Architecture Review Notes
**Date:** 2026-06-15
**Project:** OpenHiveOS
**Facilitator:** Elizabeth
**Primary Voice:** Silas
**Topic:** Agent Task Status Lifecycle — Autonomous Status Progression

---

## Problem Statement

Agents are not autonomously progressing their task statuses through the permitted intermediate states (`todo → wip → review → pending-close`). Every status update requires Elizabeth to intervene manually. This is a coordination failure, not a policy failure. The state machine exists (ARCH-023 is binding). The MCP tools exist. Agents simply are not using them. The result is a board that does not reflect actual work state at L10 time — a direct Scorecard metric failure.

## Constraints

**Business:**
- Elizabeth's time is the scarcest resource on the team. Manual status updates block the PM seat from PM work.
- Board accuracy at L10 meeting time is a Scorecard metric.
- No sprint should close requiring manual status archaeology.

**Technical:**
- ARCH-023 is binding: `pending-close` is the agent terminal state. `done` is Elizabeth-only. The two-actor close model does not change.
- M3 gate (blocks `done` from assignee tokens) is in production and is not on the table.
- Agents interact with the board exclusively via the `update_task` MCP tool. No direct DB writes.
- All transitions must be auditable.

**Out of scope:**
- Revisiting `pending-close` or the two-actor close model
- Automated CI-triggered status updates
- Replacing MCP tools with webhook-based push model
- Any change to Elizabeth's approval step for `done`

**Prior context:**
- ARCH-023 (2026-06-12): `pending-close` introduced, M3 gate active
- Valid agent state path: `todo → wip → review → pending-close`
- Elizabeth-only: `pending-close → done`, setting `rework`

---

## Options Considered

### Option A — MCP Gateway Pre-Flight Interceptor
Add middleware to the tool dispatch pipeline that runs a status pre-flight check on every inbound tool call. Augment response with a `status_drift_warning` field. Soft-block first; configurable hard-block on repeat non-compliance. Requires new `src/mcp/middleware/statusDriftInterceptor.ts`, an in-memory session log keyed by agent token (TTL 24h), and a new `getActiveAssignedTasksForAgent()` query. No schema changes.

**Pros:** In-band, persistent signal that agent cannot ignore. Zero agent instruction changes. Soft-block-first is safe to deploy. Fully auditable.

**Cons:** Breaks stateless dispatch assumption. Per-call DB round-trip on all tool calls (including high-frequency reads). In-memory session log is silently reset on PM2 restarts. False positives on exploratory sessions. Complex to test correctly.

**Effort:** High (3–5 dev-days)
**Murphy risk flag:** `tool-dispatcher.ts` modification risks regression on the cron worker path currently in production. In-memory session store doesn't survive PM2 cluster restarts — soft-block logic resets silently on every deploy.

---

### Option B — Cron-Driven Drift Scanner with Escalation Queue *(Selected)*
A scheduled cron (every 30 minutes) cross-joins agent activity signals (thoughts table) against task state. Detects drift when an agent has emitted thoughts but their task remains in a pre-progression status beyond a defined threshold. Creates a `task_drift_log` table and surfaces confirmed drift via `must_surface: true` concern thoughts — existing escalation path to Elizabeth's tooling. Follows ARCH-011 cron infrastructure exactly.

**Pros:** Fully decoupled from agent in-session behaviour. Covers all transition gaps with tunable thresholds. Durable audit log for retrospective Scorecard data. No MCP layer changes. No new stateful process components.

**Cons:** Reactive, not preventive — drift exists before detection. Thoughts-as-proxy is imprecise (false negatives if agent operates in silent mode). Adds migration and new table.

**Effort:** Low–Medium (1.5–2 dev-days)
**Murphy refinement (accepted):** Three thresholds must be defined before implementation:
- `detectTodoDrift`: task in `todo` ≥4h after thought activity in same session window
- `detectWipStaleness`: `wip` ≥48h with no assignee thoughts in last 24h
- `detectReviewStaleness`: `review` ≥72h with no owner action
- All three live in a config constant — tunable without deploy

---

### Option C — Session-Open Protocol + Audit Cron
Restructure all agent mode instructions with a Session-Open Checklist (query assigned todo tasks, call `update_task` to wip, emit a decision thought declaring scope). Add a Session Audit Cron that measures compliance per session and produces a Scorecard metric. Requires updating all agent mode files and a `session_audit_log` migration.

**Pros:** Low instruction change cost. Creates measurable compliance rate. Audit is retrospective across all agents.

**Cons:** Fundamentally instructional — LLM compliance degrades under long context windows. "Session" has no schema-backed definition; audit cron depends on timestamp inference. Multi-agent instruction coordination is a cross-sprint dependency. Murphy cannot commit to landing this in S15 alone.

**Effort:** Low–Medium (instruction changes) + Low–Medium (audit cron) — but cross-sprint coordination risk
**Murphy verdict:** Rejected for S15. Instruction component will proceed as complementary work under Clarence.

---

## Decision Matrix

| Option | Effort | Platform Fit | Security Risk | Ops Complexity | Test Complexity | Votes |
|--------|--------|-------------|--------------|----------------|-----------------|-------|
| **A — Pre-Flight Interceptor** | High | Medium | Low | High | High | S16+ tech debt |
| **B — Cron Drift Scanner** | Low–Med | High | Low | Low | Medium | **Silas ✅ Murphy ✅ Elizabeth ✅** |
| **C — Session-Open Protocol** | Low–Med | Medium | Low | Low | Low | Complementary only |

---

## Decision

**Chosen: Option B — Cron-Driven Drift Scanner with Escalation Queue**

---

## ADR — ARCH-025: Agent Task Status Drift Detection via Cron-Driven Scanner

**Date:** 2026-06-15
**Project:** OpenHiveOS
**Status:** Decided
**Decision Owner:** Silas
**Approved by:** Elizabeth

---

### Context

ARCH-023 formalised `pending-close` as the agent terminal state and added the M3 gate to block direct `done` writes from assignee tokens. These controls enforce the two-actor close model correctly. The adjacent failure — agents not progressing through the intermediate states (`todo → wip → review → pending-close`) — was not addressed by ARCH-023. That gap is producing operational friction: Elizabeth is manually updating task statuses that agents should be updating autonomously, pulling PM bandwidth from planning work and causing board inaccuracy at L10 meetings.

Three options were reviewed: a pre-flight interceptor on the MCP dispatch layer, a cron-driven drift scanner, and a session-open protocol via mode instruction restructuring. The squad converged on the cron-driven scanner.

### Decision

Introduce a `taskDriftScanner` cron handler following the existing ARCH-011 cron infrastructure pattern. The scanner runs every 30 minutes and detects agent task status drift by cross-joining the `thoughts` table (activity signal) against `tasks` (current status). Three detection functions are introduced: `detectTodoDrift`, `detectWipStaleness`, and `detectReviewStaleness`. Confirmed drift events are written to a new `task_drift_log` table and surfaced to Elizabeth via `store_thought` with `must_surface: true`. All three staleness thresholds live in a named config constant (`DRIFT_THRESHOLDS`) — tunable without a deploy.

As a complementary measure, Clarence will update agent mode instructions to include a Session-Open Checklist. This is instructional reinforcement only — it is not the primary enforcement mechanism and carries no audit infrastructure.

### Rationale

Option B is selected because it:
- Fits cleanly into the ARCH-011 cron pattern with no new infrastructure
- Does not touch `tool-dispatcher.ts` (which is shared with the cron worker path — already in production)
- Does not introduce stateful components that reset on PM2 cluster restarts
- Produces durable audit data (Scorecard metric: Agent Status Drift Rate, events per sprint)
- Is deliverable within S15 without displacing active feature work
- Is validated by both the systems seat (Silas) and the implementation seat (Murphy)

Option A (pre-flight interceptor) is the correct long-term architectural answer — in-band enforcement cannot be ignored by agents. It is deferred to S16 because the PM2 restart problem and the per-call DB latency impact require careful design before production deployment. The drift scanner provides the evidence baseline needed to design Option A's hard-block threshold correctly.

### Trade-offs Accepted

The scanner is reactive, not preventive. An agent can remain in `todo` for up to 30 minutes before drift is detected. Board accuracy at L10 time requires that the meeting cadence is offset from the cron cycle — if L10 runs at :00, ensure the cron last fired no more than 30 minutes prior.

The `thoughts` table as an activity proxy produces false negatives for agents operating in "silent mode" (no thought emissions). This is an accepted limitation; the alternative (per-call DB round-trip on all tool invocations) is a worse trade-off for the current scale.

### Consequences

- **Schema:** New migration `020_task_drift_log.sql` adding `task_drift_log` table
- **Code:** New `src/cron/taskDriftScanner.ts`, new `src/db/queries/driftScanner.ts`, cron registry entry
- **Config:** `DRIFT_THRESHOLDS` constant with values `{ todoDriftHours: 4, wipStaleHours: 48, reviewStaleHours: 72 }` — defined in `src/config/driftThresholds.ts`
- **Scorecard:** New metric: **Agent Status Drift Rate** (drift events per sprint) — add to L10 Scorecard starting S16
- **Complementary:** Clarence updates all agent mode instruction files with Session-Open Checklist (instructional, not enforced by code)
- **Tech debt logged:** Option A (pre-flight interceptor) logged as a documented tech debt item for S16, owned by Silas

### Security Review

No change to the M3 gate or ARCH-023 state machine. No new authentication or authorization surface. The `task_drift_log` table contains agent slugs and task IDs — no secrets or personal data. Read access to `thoughts` table is already granted via existing reader role (migration 010). Risk posture: **no new risk introduced**.

### Rejected Alternatives

- **Option A — MCP Pre-Flight Interceptor:** Correct long-term answer; deferred. PM2 restart clears the in-memory session log silently (soft-block resets on every deploy). Per-call DB round-trip adds 2–5ms to every tool call including high-frequency reads. `tool-dispatcher.ts` modification risks cron worker regression in production. Requires careful design and a dedicated sprint. Logged as S16 tech debt (Silas, owner).
- **Option C — Session-Open Protocol + Audit Cron:** Instructional mechanism alone is insufficient; LLM compliance degrades under long context windows. "Session" has no schema-backed definition — the audit cron would measure timestamp inference, not actual session compliance. Multi-agent instruction coordination is a cross-sprint dependency. The mode instruction update component will proceed under Clarence as complementary reinforcement.

---

## Action Items

- [ ] Murphy: Create `020_task_drift_log.sql` migration — **Owner: Murphy** — **Due: S15 Day 3 (2026-06-17)**
- [ ] Murphy: Implement `src/db/queries/driftScanner.ts` with `detectTodoDrift()`, `detectWipStaleness()`, `detectReviewStaleness()` and `DRIFT_THRESHOLDS` config constant — **Owner: Murphy** — **Due: S15 Day 4 (2026-06-18)**
- [ ] Murphy: Implement `src/cron/taskDriftScanner.ts` cron handler + cron registry entry — **Owner: Murphy** — **Due: S15 Day 4 (2026-06-18)**
- [ ] Murphy: Write tests (drift scanner cron integration tests, query function unit tests) — **Owner: Murphy** — **Due: S15 Day 5 (2026-06-19)**
- [ ] Clarence: Update all agent mode instruction files with Session-Open Checklist — **Owner: Clarence** — **Due: S15 Day 5 (2026-06-19)**
- [ ] Clarence: File `docs/ARCH-025-task-status-drift-detection.md` with this ADR — **Owner: Clarence** — **Due: S15 Day 3 (2026-06-17)**
- [ ] Silas: Log Option A (pre-flight interceptor) as S16 tech debt item with design notes — **Owner: Silas** — **Due: S15 Day 5 (2026-06-19)**
- [ ] Elizabeth: Add **Agent Status Drift Rate** to L10 Scorecard starting S16 — **Owner: Elizabeth** — **Due: S15 Sprint Close (2026-06-21)**
- [ ] Elizabeth: Create task for Murphy (S15-BE-02) covering migration + scanner implementation — **Owner: Elizabeth** — **Due: Today (2026-06-15)**
