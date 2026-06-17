# Sprint Planning Notes
**Date:** 2026-06-15  
**Project:** OpenHiveOS  
**Facilitator:** Elizabeth  
**Sprint:** 15  
**Sprint Goal:** Restore integration test infrastructure (PM2 schema fixtures), validate OAuth2 gateway stability under load, and align dashboard UI to the io-brand-rocket token system.  
**Sprint Start:** 2026-06-15  
**Sprint End:** 2026-06-21  
**Sprint Health Prediction:** 🟡 Achievable with risk

---

## PM Intelligence Summary

### Model 1 — Fragility Index
| Area | Zone | Action |
|---|---|---|
| OAuth2 gateway (S15-ARCH-01) | 🔴 High-Risk | Risk Premium applied: M → L. New code, in-memory state, no prior load testing. Senior peer review mandatory. |
| Dashboard DS compliance (#1752) | 🟡 Watch | io-design-system 85% intent overlap (Nova). Option A coordination required before close. |
| PM2 test fixtures (S15-BE-01) | 🟡 Watch | Migration gap 009–019 is unknown failure surface. Budget 1 day for gap resolution. |
| Agent detail view (#1757) | 🟢 Stable | Scaffold confirmed. S sizing correct. Clean slate. |
| Security reviews (SEC-01/02) | 🟢 Stable | Bounded audit work. No code risk. |

### Model 2 — Velocity Decay
No decay detected. S14 delivered all 3 FE stories Day 3. Clean sprint boundary. No volume adjustment required.

### Model 3 — Estimation Bias Correction (Private)
Shadow estimate: 21.5 agent-days vs team estimate of ~18 days. Gap: 19% — below the 20% removal threshold. Sprint commits as-is. Murphy is the most loaded seat (BE-01 + ARCH-01 overlap). If ARCH-01 stalls on Day 3, BE-01 takes priority — no scope negotiation required.

### Model 4 — Nova Cross-Project Scan
- **S15-ARCH-01:** 45% overlap with io_auth ARCH-008 — below threshold. Boundary statement required in AC.
- **#1752:** 85% overlap with io-design-system project. **Coordination call required before #1752 closes.** Option A (local tokens + migration intent) recommended.
- **S15-BE-01:** <25% overlap. No action.

### Model 5 — Environment Awareness
All PM2. No container slots. No zombie environments. No environment constraint on this sprint.

---

## Sprint Stories

| Story | Owner | Effort | DoR | Dependencies |
|-------|-------|--------|-----|--------------|
| #1757 — Agent Full-Page Detail View | Rocket | S (1–1.5d) | ✅ | None |
| #1752 — Dashboard UI DS Compliance | Rocket | M (3–4d) | ✅ Conditional | Day 1 font audit; io-design-system coordination call before close |
| S15-BE-01 — PM2 Integration Test Fixtures | Murphy | L (4–5d) | ✅ Conditional | Silas architecture ruling (issued); migration gap audit Day 1 |
| S15-ARCH-01 — OAuth2 Gateway Stability | Murphy | L (Risk Premium applied) | ⚠️ Day 1 fix | autocannon `npm install` Day 1 (30min). Rate limiter constraints in ACs. Enters sprint with Day 1 action. |
| S15-DOC-01 — Documentation Reorganization | Clarence | XS (1–2h) | ✅ | None |
| S15-DOC-02 — OAuth2 Auth Flow Guide | Clarence | S (1d) | ✅ | Murphy async sign-off Day 3 |
| S15-DOC-03 — PM2 Fixture Developer Guide | Clarence | S (1d) | ✅ Conditional | Hard gate: S15-BE-01 merged by Day 5. Carries to S16 if missed. |
| S15-INFRA-01 — PM2 CI Integration | Cooper | S (1d) | ⚠️ Split | Track A (vitest.config.ts fix) Day 1 — prerequisite for BE-01 CI. Track B (ci.yml npm test step) Day 2–3. |
| S15-SEC-02 — JWT Timing Debt Closure | Locksmith | XS (2h) | ✅ | None |
| S15-SEC-01 — OAuth2 Security Sign-off | Locksmith | S (4–6h) | ✅ | S15-SEC-02 closed first (Locksmith sequencing) |

---

## Silas Architectural Rulings (Binding for S15)

### PM2 Test Fixture Contract
The fixture is a **schema-isolation helper against a local postgres instance**. Not HTTP-level testing. Not spawning squad-api over PM2.

Contract:
```
createLocalTestSchema()
  ├── Connects to DATABASE_URL env var
  ├── CREATE SCHEMA test_<uuid>
  ├── Sets search_path for all pool connections
  ├── Applies migrations 001–019 (stripRoleGrants pattern extended)
  ├── Seeds minimum data (agent + project)
  └── Returns { pool, schemaName, teardown }
      teardown(): DROP SCHEMA test_<uuid> CASCADE
```

Testcontainers path preserved for local dev without running postgres. `USE_LOCAL_DB=true` or `CI=true` env flag routes to appropriate helper.

### `rounded-xl` on Surface B panels — acceptable?
Resolved: `rounded-xl` is acceptable **only when applied via `.ds-panel` class** (which maps to `--io-radius-xl`). Raw Tailwind `rounded-xl` combined with inline `shadow-sm` and `border-gray-200` = violation. Rocket's task is mechanical substitution to `.ds-panel` — not a design decision.

### `pruneExpiredCodes()` sweep
Ruled: **Document the opportunistic model. No `setInterval` in S15.** Load test must pair every `/authorize` with a `/token` call within each scenario. Defer background sweep to S16 only if load test reveals Map pressure.

### Load test tooling
Ruled: **`autocannon`** as devDependency in root package.json. Rationale: Node.js native, no separate binary, programmable from TypeScript, sufficient for loopback single-node validation.

---

## Nova Coordination Actions

| Action | Owner | Timing | Blocking? |
|---|---|---|---|
| #1752 / io-design-system coordination call — confirm Option A (local tokens + migration intent) vs Option B (pre-release canary) | Rocket + io-design-system maintainer | Before #1752 closes | Yes — #1752 cannot close without decision documented |
| S15-ARCH-01 — add "no federation with io_auth in scope" boundary statement to AC | Murphy | Day 1 | No — awareness only |
| S15-BE-01 — SOP seed for postgres schema isolation pattern (post-sprint) | Clarence | Post-S15 backlog | No |

**Recommendation:** Option A — implement Surface B token values locally using io-brand-rocket canonical names as CSS custom properties. When `@io-labs/design-system` ships in Q3, migration is a named task not discovery work. io-design-system DS-029→DS-036 sequencing is still in progress; consuming as a devDependency now introduces churn risk.

---

## Dependency Sequence

```
DAY 1 (2026-06-15) — Unblock everything
├── Cooper: vitest.config.ts — remove DOCKER_HOST hardcode, add CI env routing (INFRA-01 Track A)
├── Murphy: autocannon install + rate limiter constraints in ARCH-01 ACs
├── Murphy: migration gap audit 009–019 in test schema (BE-01 Day 1)
├── Rocket: font audit — Inter vs Familjen Grotesk baseline (#1752 scope gate)
├── Locksmith: S15-SEC-02 — confirm token-comparison.ts is canonical; close TD-S12-02
└── Clarence: S15-DOC-01 — organize-docs.sh + cross-reference audit

DAY 2 (2026-06-16)
├── Cooper: ci.yml npm test step (INFRA-01 Track B — depends on Track A done)
├── Murphy: createLocalTestSchema() implementation (BE-01)
├── Locksmith: S15-SEC-01 begins (OAuth2 pre-audit)
├── Rocket: Begin #1752 ds-panel migration (if font audit resolved Day 1)
└── Clarence: S15-DOC-02 — OAuth2 gateway developer guide draft

DAY 3 (2026-06-17)
├── Cooper: Validate npm test passes in CI on Murphy's branch
├── Murphy: ARCH-01 — load test harness against /authorize → /token flow
├── Murphy: BE-01 — integration tests against local schema
└── Rocket: #1757 — Agent Full-Page Detail View (S story, 1–1.5 days)

DAY 4 (2026-06-18)
├── Murphy: BE-01 PR open for review (Day 4 target)
├── Murphy: ARCH-01 — load test results → stability verdict
├── Rocket: #1752 PR open (ds-panel migration complete)
└── Clarence: DOC-02 incorporate Murphy review + publish

DAY 5 (2026-06-19)
├── Murphy: BE-01 MERGED (hard deadline for DOC-03 gate)
├── Locksmith: S15-SEC-01 CLOSED with findings report
└── Clarence: DOC-03 begins (if BE-01 merged)

DAY 6–7 (2026-06-20–21)
├── Clarence: DOC-03 polish + publish
└── Buffer: ARCH-01 float if load test edge cases surface
```

**Cross-agent dependency table:**

| Upstream | Downstream | Dependency |
|---|---|---|
| Cooper INFRA-01 Track A (vitest.config.ts) | Murphy BE-01 CI validation | Tests won't pass in CI without socket fix |
| Murphy BE-01 merge (Day 5) | Clarence DOC-03 | Guide cannot be written before fixture contract is code-complete |
| Murphy BE-01 fixture interface | Cooper INFRA-01 Track B (ci.yml) | CI test step needs to know what it runs |
| Locksmith SEC-02 closed | Locksmith SEC-01 starts | Locksmith's sequencing — not circular |
| Rocket Day 1 font audit | #1752 scope commitment | Can't commit full scope until typography baseline confirmed |
| autocannon install (Murphy Day 1) | ARCH-01 load test | Trivial install, 30 minutes |

**Circular dependencies:** None.  
**Unresolvable blockers:** None. All Day 1 actions are executable immediately.

---

## Backlog Refinement List

| Story | Reason Not Entering Sprint | Owner | Target Ready Date |
|---|---|---|---|
| #1773 — JIRA Adapter | Deferred gate: ClickUp MCP (project 55) must reach production readiness first. IDS ruling 2026-06-15. | Murphy | S16 planning review |
| S15-DS-01 — Design System Publication Pipeline | io-design-system DS-029→DS-036 still in progress. Token API not stable enough to consume as devDependency. Option A confirmed as path — revisit at S16 once io-design-system reaches DS-032+ milestone. | Rocket | S16 |
| #1804 — Repo public visibility flip | All gates passed. Deferred to post-sprint ops window. Awaiting Richo launch signal. | Cooper | On-demand |

---

## Cooper Infrastructure Risk Flags (ARCH-01 Load Test)

All three flagged to Murphy before ARCH-01 load test design:

1. **Auth code Map memory:** Under sustained load, if /authorize is hammered without /token completions, codes accumulate until 60s TTL. Load test design must pair every /authorize with /token. Pre-test `authCodes.clear()` recommended via test-only hook (never in production).
2. **Rate limiter caps at 30/min/IP by design.** Load scenarios above 30/min will return 429 — test must assert 429s, not treat them as failures. This is the ceiling; design test accordingly.
3. **Load test must originate from localhost.** GATEWAY_BASE is loopback-only. Remote load traffic rejected at network layer.

---

## Locksmith Security Flags (Pre-Audit)

All Low/Informational — no P0/P1. No sprint blocker.

| # | Surface | Pre-Audit Observation |
|---|---|---|
| F1 | /token response | access_token = raw agent bearer token (by design; loopback-only acceptable) |
| F2 | resolveAgentSlug | Dual-query timing differential for invalid tokens (noise-floor on loopback) |
| F3 | /.well-known | Discloses port + endpoint paths (correct per RFC 8414; flag if ever off-loopback) |
| F4 | authCodes Map | Restart clears codes (availability, not security; VS Code auto-retries) |
| F5 | Scorecard ref | TD-S12-02 names wrong file (token-verification.ts → token-comparison.ts); fixed in SEC-02 |

---

## Action Items

- [ ] Murphy: `npm install --save-dev autocannon @types/autocannon` — **Due: 2026-06-15 EOD**
- [ ] Murphy: Add boundary statement to S15-ARCH-01 ACs — **Due: 2026-06-15 EOD**
- [ ] Cooper: Remove `DOCKER_HOST` from vitest.config.ts; add CI env routing — **Due: 2026-06-15 EOD**
- [ ] Rocket: Day 1 font audit (Inter vs Familjen Grotesk) — **Due: 2026-06-16 EOD**
- [ ] Rocket + io-design-system maintainer: Coordination call — confirm Option A — **Due: Before #1752 closes**
- [ ] Locksmith: S15-SEC-02 closure — **Due: 2026-06-16 EOD**
- [ ] Elizabeth: Create sprint tasks in OpenSquad for all S15 stories — **Due: 2026-06-15**
- [ ] Silas: Store dependency map + DoR failures in memory — **Due: 2026-06-15**

---

## Retrospective Notes (S14 → S15)

**What went well in S14:**
- All 3 FE stories delivered Day 3 — fastest frontend sprint on record
- Scout gate was fast and clean (same-session review)
- Scorecard methodology established for the first time — now we have a baseline

**What didn't (carry into S15):**
- Integration test infrastructure architectural debt surfaced (Testcontainers vs PM2 mismatch) — this was invisible until scorecard analysis
- Coverage measurement blocked all sprint: 8.62% vs estimated 40–50% real coverage
- No CI test step existed — discovered in S15 planning, not S14 retrospective

**S15 Theme:** Fix the foundation. The three stories that matter most (BE-01, INFRA-01, SEC-01/02) are all infrastructure and trust-surface work. Frontend (Rocket) runs in parallel but the sprint's definition of success is measured by: real coverage unblocked, OAuth2 signed off, dashboard token-aligned.
