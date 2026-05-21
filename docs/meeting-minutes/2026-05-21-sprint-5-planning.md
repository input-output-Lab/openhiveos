---
title: "Sprint 5 Planning — OpenHiveOS"
date: 2026-05-21
author: "Elizabeth"
tags:
  - type/meeting-minutes
  - project/openhiveos
  - domain/planning
  - audience/team
doc_id: "MTG-2026-05-21-S5-PLANNING"
---

# Sprint 5 Planning — OpenHiveOS

**Date:** 2026-05-21
**Type:** Sprint Planning + Day 0 Decisions
**Facilitator:** Elizabeth
**Attendees:** Richo (Founder/Integrator), Elizabeth (PM), Silas (Systems Architect — feasibility assessment)

---

## Sprint Window

**Start:** 2026-05-24 (Saturday)
**End:** 2026-06-07 (Saturday)
**Duration:** 14 calendar days

---

## Sprint Goal

> *An operator who runs Stages 1–3 of the canonical onboarding sequence ends with a fully running Squad Instance with a verified identity layer.*

Three-gate delivery: Ethos Seal initialisation (Stage 1), agent provisioning (Stage 2), squad-api auth foundation (Stage 3).

---

## Day 0 Decisions

Three open questions resolved before sprint kick-off.

### D1 — E3: openBridge Compose Profile

**Question:** Does openBridge use the `integration` Compose profile or a dedicated profile?
**Decision:** Dedicated `openbridge` Compose profile.
**Owner:** Richo (ruling)
**Rationale:** openBridge is fundamental to inter-OpenHive interactions — it is not an integration in the incidental sense. Distinct profile correctly reflects its architectural status. Nova's `integration` preference (taxonomy) was superseded.
**Impact:** ARCH-016 ADR updated to v1.2. Task #1403 closed DONE.

### D2 — Original Sprint 5 Scope

**Question:** Original Sprint 5 backlog items (Cron Worker #1331, Dockerfile, O-1 fix) — hold or defer?
**Decision:** Deferred to Sprint 6.
**Owner:** Richo (confirmed)
**Rationale:** Architecture sessions this sprint (ARCH-012, -013, -014, -016) take priority. Foundation layer delivery is the correct sequence.

### D3 — ARCH-015 D9 Bridge Update Task (#1392)

**Question:** Task #1392 ("Bridge update — POST to OPENHIVEOS_INGESTION_URL after each loop") — is this OpenHiveOS's task?
**Decision:** Mark DONE. Bridge adoption is external.
**Owner:** Richo (ruling)
**Rationale:** OpenHiveOS defines the integration spec. nova-telegram-bridge is operationally live. When it adopts ARCH-015 D9, that action belongs to the Bridge's backlog. "This project creates the rules of the game." Memory #1904 (T-01 reframe) confirmed.

---

## Silas Feasibility Assessment — Summary

**Verdict:** Stream 4 (ARCH-016 mcp-gateway) slips to Sprint 6. Streams 0–3 proceed.

| Agent | Stories | Load | Feasible? |
|---|---|---|---|
| Murphy | 16 | ~11 dev days (at capacity) | ✅ Without S4 |
| Cooper | 5 | ~1 dev day | ✅ |
| Clarence | 5 | ~1.75 dev days | ✅ |
| Locksmith | 3 SEC gates | ~2.5 days of review | ✅ Without S4 |
| Silas | 1 (schema ruling) | ~0.75 dev days | ✅ |
| Elizabeth | 1 (admin) | XS | ✅ |

**Stream 4 slip rationale:**
1. Removing S4 brings Murphy from 13.5 to ~11 dev days — within capacity.
2. Reduces Locksmith from 4 SEC gates to 3. SEC-B (10 criteria, HMAC + SERIALIZABLE) is the most consequential gate — it must not be compressed.
3. E1/E2 closed. Murphy enters Sprint 6 warm on F8. Zero re-ramp cost.
4. E3 now resolved at Day 0 — Sprint 6 F8 is scoped correctly from day one.

**Risk flags from Silas:**
- **#1411 F8 (mcp-gateway build)** — labeled M, actual risk M+/L. stdio↔SSE bridging with MCP SDK has subprocess backpressure edge cases. Sprint 6 allocation.
- **#1358 one-init.ts** — labeled M, actual risk M+. SERIALIZABLE transaction retry pattern is the risk. Mitigation: stub scaffold on Day 1 to surface edge cases early.
- **#1351 auth middleware** — labeled M, actual risk M+. `SET LOCAL ROLE` per request requires careful pool client handling.
- **Critical path has zero slack.** One-day slip in #1358 cascades through Locksmith SEC-B and eliminates all buffer.

---

## Sprint 5 Scope — Committed Stories

### Stream 0 — PRE-A1 Gate (Day 1, blocking)

| Story | Owner | Size | Task |
|---|---|---|---|
| S5-00: Fix migrate gate — extend to verify full migration sequence | Murphy | XS | #1355 |

### Stream 1 — ARCH-012: squad-api Auth Foundation

| Story | Owner | Size | Task |
|---|---|---|---|
| S5-01: `003_squad_api_role.sql` — `CREATE ROLE IF NOT EXISTS openhiveos_reader` | Murphy | XS | #1346 |
| S5-02: `003_dashboard_agent.sql` — insert dashboard agent row | Murphy | XS | #1347 |
| S5-03: Confirm port 3005 free, update `docker-compose.yml` | Cooper | XS | #1348 |
| S5-04: Auth middleware — token validation, rate limiting, `SET LOCAL ROLE` per request | Murphy | M+ | #1351 |
| S5-05: Locksmith SEC-A gate — SEC-A1 through SEC-A6 | Locksmith | S | #1352 |

*Deferred to Sprint 6: A5 (Vue SPA scaffold), A6 (static serving).*

### Stream 2 — ARCH-013: Ethos Seal

| Story | Owner | Size | Task |
|---|---|---|---|
| S5-06: Schema ruling — singleton pointer vs UNIQUE partial index for `--revise` | Silas | XS | #1356 |
| S5-07: `004_ethos_seal.sql` migration | Murphy | XS | #1357 |
| S5-08: `scripts/one-init.ts` — readline CLI, HMAC signing, SERIALIZABLE revise, file export | Murphy | M+ | #1358 |
| S5-09: `checkEthosSeal()` boot integrity check | Murphy | S | #1359 |
| S5-10: Docker Compose `init` profile service (ethos) | Cooper | XS | #1360 |
| S5-11: `.env.example`, `.gitignore`, `.dockerignore` (ethos seal vars) | Murphy | XS | #1361 |
| S5-12: `GET /api/ethos-seal` route | Murphy | S | #1362 |
| S5-13: `004_ethos_seal.sql` parity in opensquad-mcp-server | Murphy | XS | #1365 |
| S5-14: `spawn-protocol.md` — declare one-init binding | Clarence | XS | #1367 |
| S5-15: Locksmith SEC-B gate — SEC-B1 through SEC-B10 | Locksmith | S | #1363 |

*Deferred to Sprint 6: EthosSealView (B10 Dashboard).*

### Stream 3 — ARCH-014: Dynamic Provisioning

| Story | Owner | Size | Task |
|---|---|---|---|
| S5-16: Extract `src/auth/upsert-agent.ts` | Murphy | S | #1369 |
| S5-17: `--revoke` flag on `provision-agent-token.ts` | Murphy | S | #1370 |
| S5-18: `scripts/provision-all-agents.ts` batch CLI | Murphy | M | #1371 |
| S5-19: Docker Compose `init` provision service | Cooper | XS | #1372 |
| S5-20: `.env.example` — `PROVISION_ENV_DIR` | Cooper | XS | #1373 |
| S5-21: Confirm `UNIQUE` constraint on `agents.token_hash` | Murphy | XS | #1375 |
| S5-22: `spawn-protocol.md` — Phase 3 binding to `provision-all-agents.ts` | Clarence | XS | #1376 |
| S5-23: `--help` text on both provisioning scripts | Murphy | XS | #1377 |
| S5-24: Locksmith SEC-C gate — SEC-C1 through SEC-C8 | Locksmith | S | #1378 |
| S5-25: `docs/08-agent-onboarding.md` — Stages 1–3 operator runbook | Clarence | S | #1379 |
| S5-26: `ARCH-001` update — reference new provisioning commands | Clarence | XS | #1380 |
| S5-27: Glossary — Agent Token definition and provisioning references | Clarence | XS | #1382 |
| S5-28: SPIKE #250 checkpoint tracking | Elizabeth | XS | #1381 |

*Deferred to Sprint 6: Dashboard agents view (C7).*

---

## Deferred to Sprint 6

| Item | Reason |
|---|---|
| ARCH-016 mcp-gateway (all F-items: #1404–#1416, #1411, #1412) | Murphy oversubscribed; Locksmith at 4-gate limit; E3 now resolved for clean start |
| ARCH-015 LLM Usage (all 14 tasks) | Gated on squad-api running; Bridge adoption is external per T-01 reframe |
| Dashboard UI: A5, A6, B10, C7 | squad-api must be live first; scope coherence |
| Cron Worker (#1331), Dockerfile, O-1 fix | Architecture foundation takes priority |

---

## Critical Path

```
Day 1    #1355 PRE-A1 gate ─── unblocks all migrations
         #1356 Silas schema ruling ─── unblocks #1357

Day 2–3  Migrations: #1346, #1347, #1357, #1375
         #1351 auth middleware starts

Day 3–5  #1351 complete → SEC-A submission (#1352)
         #1358 one-init.ts starts (parallel)

Day 5–7  #1358 complete → #1359 (boot check) → #1362 (API route)
         SEC-B submission (#1363)
         #1369 upsert-agent.ts starts (parallel)

Day 7–9  #1371 provision-all-agents.ts complete → SEC-C submission (#1378)
         Locksmith: SEC-A + SEC-B running

Day 10–13 Locksmith: SEC-C
           Clarence: runbooks finalised post-SEC-C sign-off

Day 14   Integration smoke test + buffer
```

**Zero slack.** One-day slip in #1358 cascades to Locksmith SEC-B and removes all buffer.

---

## Timing Notes — Clarence

`#1379 docs/08-agent-onboarding.md` should be drafted in outline form on Days 4–5. Final command outputs and verification steps filled in after #1371 and Locksmith SEC-C sign-off (Days 10–11). Do not wait for implementation to stabilise before starting the structure.

---

## Definition of Done — Sprint 5

- [ ] `docker compose --profile init run --rm one-init` completes successfully for a fresh Squad Instance
- [ ] `docker compose --profile init run --rm provision --write-env .env.tokens` provisions all 9 agents
- [ ] `docker compose up` brings squad-api up on port 3005 with `GET /health → {status: ok}` and correct `openhiveos_reader` role active
- [ ] Boot rejects startup if Ethos Seal is missing or invalid (`checkEthosSeal()` fires)
- [ ] Locksmith has signed off SEC-A, SEC-B, and SEC-C before any stream merges to main
- [ ] `docs/08-agent-onboarding.md` covers Stages 1–3 end-to-end including rotation and revocation

---

## Action Items

| # | Action | Owner | Due |
|---|---|---|---|
| 1 | Resolve E3 DONE — update ARCH-016 to v1.2 | Elizabeth | ✅ 2026-05-21 |
| 2 | Mark #1392 DONE (Bridge adoption is external) | Elizabeth | ✅ 2026-05-21 |
| 3 | Mark #1403 DONE (E3 closed) | Elizabeth | ✅ 2026-05-21 |
| 4 | Murphy: stub one-init.ts process scaffold on Day 1 alongside #1355 | Murphy | 2026-05-24 |
| 5 | Silas: schema ruling (#1356) delivered by end of Day 2 | Silas | 2026-05-25 |
| 6 | Locksmith: 24h initial-review turnaround on each SEC gate submission | Locksmith | Rolling |
| 7 | Cooper: complete XS Compose tasks early sprint; do not schedule F9 until Sprint 6 | Cooper | Days 1–3 |
| 8 | Clarence: draft #1379 outline structure Days 4–5; finalise Days 10–11 | Clarence | 2026-05-29 (outline) |
| 9 | Elizabeth: advance sprint cadence (blocked via OpenBridge; track via memory/minutes) | Elizabeth | 2026-05-24 |

---

## Notes

**ARCH-016 status:** v1.2 as of this meeting. All open questions (E1, E2, E3) closed. mcp-gateway builds in Sprint 6 with full clarity on: package location (`packages/mcp-gateway/`), Compose topology (loopback `ports:`), and openBridge profile (`openbridge` — separate from `integration`).

**Portfolio project note:** OpenHiveOS is a portfolio project in OpenSquad. Sprint advancement via `advance_sprint` is blocked pending OpenBridge sync. Sprint 5 is tracked via memory, meeting minutes, and task status on the board.

**Health prediction:** 🟡 Yellow. Achievable with no Murphy blockers and Locksmith holding 24h turnaround. The critical path is real — flag to Richo immediately if #1358 (one-init.ts) estimates exceed 2.5 days mid-sprint.
