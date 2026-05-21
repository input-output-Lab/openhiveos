---
title: "ARCH-012 — Arch Review: Squad API + Dashboard Service Boundary"
date: 2026-05-21
updated: 2026-05-21
author: "Elizabeth"
type: meeting-minutes
tags:
  - type/meeting-minutes
  - project/openhiveos
  - domain/architecture
  - domain/backend
  - domain/frontend
  - domain/devops
  - domain/security
  - audience/technical
---

# ARCH-012 Arch Review — Squad API + Dashboard Service Boundary

**Date:** 2026-05-21  
**Facilitator:** Elizabeth  
**Protocol:** arch-review.prompt.md  
**ADR filed:** [ARCH-012](../ARCH-012-squad-api-dashboard-architecture.md)

---

## Attendees

| Seat | Agent | Role |
|---|---|---|
| Facilitator / PM | Elizabeth | Meeting ownership, Step 1 problem framing, action items |
| Systems Architect | Silas | Options (Step 2), Decision matrix (Step 4) |
| Backend | Murphy | Cross-seat review (Step 3) |
| Frontend | Rocket | Cross-seat review (Step 3) |
| DevOps | Cooper | Cross-seat review (Step 3) |
| Strategic / Cross-project | Nova | Cross-seat review (Step 3) |
| Security | Locksmith | Cross-seat review (Step 3), binding security ruling |
| Documentation | Clarence | ADR authorship (Step 5) |

---

## Agenda

1. Problem framing (Elizabeth)
2. Options proposal (Silas) — 3 options
3. Cross-seat review — all seats in parallel
4. Decision matrix synthesis (Silas)
5. ADR authorship (Clarence)
6. Memory sync + action items (Elizabeth)

---

## Key Decisions

**D1 — Option A selected unanimously.**  
Squad API: Express/TypeScript ESM, port 3005, localhost bind. Dashboard: Vue 3 SPA embedded at build time via `express.static`. MCP container unchanged.  
*Owner: Silas. Effective: 2026-05-21.*

**D2 — Dashboard auth model: Agent bearer token.**  
Dashboard is a named principal (`dashboard` row in `agents` table, provisioned via migration). Token delivered via `DASHBOARD_AGENT_TOKEN` env variable.  
*Owner: Locksmith (binding ruling). Effective: 2026-05-21.*

**D3 — DB role: `openhiveos_reader` (SELECT-only).**  
Squad-api connects via `openhiveos_reader`, scoped to SELECT grants. No DML, no DDL. No superuser fallback path.  
*Owner: Silas. Effective: 2026-05-21.*

**D4 — Port: 3005 (not 3002).**  
Port 3002 is already occupied on the production host by `google-workspace-mcp-server`. Port 3005 is the next clean allocation.  
*Owner: Cooper (raised the conflict; must confirm 3005 is free — PRE-2).*

**D5 — Option B blocked.**  
Violates ARCH-004 Decision 3A. Introduces CORS attack surface. Requires superseding ADR. Deferred — not permanently rejected. Conditionally revisitable if SPIKE #250 changes the auth model.

**D6 — Option C hard-vetoed.**  
OWASP A01:2021 (broken access control — MCP superuser role on REST surface). Stdio session drops on API restart. Vetoed by Cooper and Locksmith. Permanently closed.

---

## Seat Inputs Summary

### Murphy (Backend)
- Option A approved.
- PRE-1 flagged: `CREATE ROLE IF NOT EXISTS` guard required on role migration to prevent crash on second run.
- DB connection pool ceiling documented: mcp max:10 + squad-api max:5 = 15 total. Must be tracked.
- Option C non-starter.

### Rocket (Frontend)
- Option A unambiguously approved.
- Same-origin production mode eliminates CORS entirely.
- Option B: conditional blocker pending ARCH-004 3A supersession.
- Option C: hard blocker (session disruption on MCP restart drops agent connections).

### Cooper (DevOps)
- Option A conditionally approved.
- **Port 3002 conflict identified** — `google-workspace-mcp-server` owns 3002 on production host.
- Recommends port 3005 or `SQUAD_API_PORT` env-driven. PRE-2: Cooper must confirm 3005 is free before first build.
- PRE-1 (migration idempotency) independently confirmed as required.
- Option C vetoed: deployment restart drops stdio sessions.

### Nova (Cross-project)
- Option A approved with two flags:
  1. **SPIKE #250 timing risk** — REST auth design should be reviewed against SPIKE #250 (peer-agent auth, opensquad) before cross-squad contract is locked. Non-blocking; tracked as open condition.
  2. **DB role naming inconsistency** — `squad_api_user` (opensquad) vs `openhiveos_reader` (proposed) violate a naming standard. Nova recommends standardizing to `<project>_reader` pattern across all IO Labs projects.
- Data source boundary confirmed: OpenHiveOS API reads its own DB only. No access to opensquad DB.

### Locksmith (Security — binding)
- Options B and C: **BLOCKED.**
- Option A: **CONDITIONALLY APPROVED** — six binding merge gates.
- Auth model: Agent bearer token (`dashboard` agent principal in `agents` table).
- **SEC-A1:** `dashboard` row via migration only.
- **SEC-A2:** `DASHBOARD_AGENT_TOKEN` in env only; gitleaks coverage required.
- **SEC-A3:** squad-api binds to `127.0.0.1` by default.
- **SEC-A4:** 20 req/min rate limiting before merge.
- **SEC-A5:** `openhiveos_reader` only — no superuser fallback.
- **SEC-A6:** No `token_hash`, `salt`, or raw token bytes in API responses.

---

## Remaining Open Items

| Item | Owner | Status |
|---|---|---|
| DB role naming standard (`openhiveos_reader` vs `squad_api_user`) | Silas | Must be resolved before migration merges — rename post-production creation requires a new migration |
| SPIKE #250 timing risk — REST auth alignment | Elizabeth | Tracked. Non-blocking. Review required when SPIKE #250 closes |
| PRE-1: `CREATE ROLE IF NOT EXISTS` guard | Murphy | Hard gate. Implementation does not begin without this |
| PRE-2: Port 3005 confirmed free on production host | Cooper | Hard gate. Cooper to verify before first build artifact |

---

## Action Items

| # | Task | Owner | Gate |
|---|---|---|---|
| A1 | Scaffold `src/squad-api/` (Express/TypeScript ESM, port 3005, health endpoint) | Murphy | After PRE-1 and PRE-2 confirmed |
| A2 | Create `003_squad_api_role.sql` with `CREATE ROLE IF NOT EXISTS openhiveos_reader` | Murphy | PRE-1 gate |
| A3 | Create `003_dashboard_agent.sql` — insert `dashboard` agent row | Murphy | SEC-A1 gate |
| A4 | Confirm port 3005 free on production host; update Compose `docker-compose.yml` | Cooper | PRE-2 gate |
| A5 | Scaffold `packages/dashboard/` Vue 3 SPA (Vite, dev proxy to 3005) | Rocket | After A1 |
| A6 | Wire `express.static('dist/dashboard')` + SPA fallback into squad-api | Murphy + Rocket | After A5 |
| A7 | Implement auth middleware: `DASHBOARD_AGENT_TOKEN` validation, SEC-A4 rate limit, SEC-A5 DB role enforcement | Murphy | SEC merge gate |
| A8 | Locksmith SEC gate review (SEC-A1 through SEC-A6) before squad-api merges to main | Locksmith | Final merge gate |
| A9 | File task: audit all IO Labs project DB roles; standardize to `<project>_reader` naming pattern | Silas | Non-blocking; tracked |
| A10 | Track SPIKE #250 (opensquad peer-agent auth) — revisit squad-api REST auth alignment on close | Elizabeth | Checkpoint (non-blocking) |

---

## Decision: Option A — Full Technical Specification

Included here for implementation reference, to avoid any future ambiguity:

| Attribute | Value |
|---|---|
| Service name | `squad-api` |
| Runtime | Node.js 20, TypeScript strict, ESM |
| Framework | Express 5 |
| Port | 3005 (env: `SQUAD_API_PORT`) |
| Default bind | `127.0.0.1` |
| DB role | `openhiveos_reader` (SELECT-only) |
| Dashboard serving | `express.static('dist/dashboard')` + SPA fallback |
| Dashboard build | `vite build` → `dist/` baked into image |
| Auth model | Agent bearer token (`dashboard` row in `agents` table) |
| Auth env var | `DASHBOARD_AGENT_TOKEN` |
| Rate limiting | 20 req/min (all routes) |
| MCP container | Unchanged — stdio only |
| Compose services | postgres, migrate, mcp, squad-api |

---

## Meeting Closed

**Result:** ARCH-012 decided. ADR filed at [docs/ARCH-012-squad-api-dashboard-architecture.md](../ARCH-012-squad-api-dashboard-architecture.md). All six SEC conditions binding. Both PRE conditions are hard gates. Action items assigned above.

*Minutes published by Elizabeth — 2026-05-21*
