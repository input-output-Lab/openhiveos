---
title: "Sprint 9 Planning — OpenHiveOS"
date: 2026-05-23
type: meeting-minutes
project: openhiveos
sprint: 9
facilitator: elizabeth
attendees:
  - elizabeth
  - silas
  - murphy
  - rocket
  - clarence
  - cooper
  - locksmith
  - nova
tags:
  - type/meeting-minutes
  - project/openhiveos
  - domain/planning
---

# Sprint Planning Notes
**Date:** 2026-05-23
**Project:** OpenHiveOS
**Facilitator:** Elizabeth
**Sprint Goal:** Ship the squad-api read routes and dashboard SPA views that give operators their first live window into the squad — a working Dashboard home, Agent Registry, and Inbox running against real data.
**Sprint Start:** 2026-05-26
**Sprint End:** 2026-06-06
**Sprint Health Prediction:** 🟡 Achievable with risk

---

## Context (Elizabeth)

**Sprint 8 delivered clean:** 12/12 stories, 241 tests, tagged v0.5.0. Pre-S9A (dashboard product strategy) and Pre-S9B (ARCH-019 architecture session) both closed before this planning session. OQ-1, OQ-3 resolved. All API contracts are locked.

**Milestone A:** June 27, 2026 — hard date. Squad-api + dashboard embed demo-able. Sprint 9 must close green to preserve the 3-sprint runway to Milestone A.

**Capacity constraints:** No known agent unavailability. Sprint is 10 working days. Neural Expressive layer carries a Risk Premium (🔴 zone, 1.5× shadow estimate applied).

**Model 3 correction applied (private):** Rocket's 6 deliverables shadow at ~1.3× committed estimate. InboxView Day 3 gate absorbs this — it is already the explicit capacity protection. No stories removed; gate is enforced strictly.

---

## Sprint Stories

| # | Story | Owner | Effort | DoR | Key Dependency |
|---|---|---|---|---|---|
| S9-BE-00 | `GET /api/agents` — add `active_task_count` (LEFT JOIN tasks, SEC-C6) | Murphy | XS (1.5h) | ✅ | Locksmith SEC-C6 ruling (received) |
| S9-BE-05 | Document `/health` response shape in `docs/openapi.yaml` | Murphy | XS (0.5h) | ✅ | Day 1 — unblocks Rocket StatusAura |
| S9-BE-02 | `GET /api/agents/:slug` — DB + manifest role, startup cache (SEC-C4/C5) | Murphy | XS (2h) | ✅ | None |
| S9-BE-03 | `GET /api/sops` — derived display_name, 200-char preview (SEC-C3, SEC-C7) | Murphy | S (3h) | ✅ | None |
| S9-BE-01 | `GET /api/tasks` — pagination, filters, tasks→projects JOIN (SEC-C1/C2/C3) | Murphy | S (3h) | ✅ | **DAY 3 GATE** → Rocket InboxView |
| S9-BE-04 | `GET /api/thoughts` — STRETCH (SEC-B1/B3, after S9-BE-01/02/03 green) | Murphy | S (3h) | ✅ (stretch) | All Murphy routes green |
| S9-FE-00 | Shared primitives: AppShell, PageHeader, StatusAura, EmptyState, DataBadge, BreadcrumbBar | Rocket | M | ✅ | StatusAura: Day 1 Murphy /health doc |
| S9-FE-01 | Neural Expressive layer: status aura @keyframes, staggered TransitionGroup, health strip, nav transition | Rocket | L 🔴 | ✅ | S9-BE-05 (health shape) by Day 1 |
| S9-FE-03 | AgentRegistryView — replace/upgrade AgentsView.vue + EthosSealView.vue into single view at `/agents` | Rocket | M | ✅ | S9-BE-00 (active_task_count) |
| S9-FE-02 | DashboardView — 3-zone (health strip + ethos chip + agent count / agent strip preview / inbox preview + cost card) | Rocket | M | ✅ | S9-BE-01 (Day 3), S9-BE-00, S9-FE-01 |
| S9-FE-05 | AppSidebar extended — 7-section nav (S9 sections active; S10–S12 disabled/coming-soon) | Rocket | S | ✅ | S9-FE-00 routes wired |
| S9-FE-04 | InboxView — 20 most recent TODOs, no pagination (CONDITIONAL) | Rocket | S | 🟡 | **GATED: Murphy S9-BE-01 by Day 3** |
| S9-OPS-01 | Verify post-Sprint 8 Docker environment: clean install, dashboard build, serve health check | Cooper | XS | ✅ | None |
| S9-SEC-01 | Security review of new backend routes — merge gate (ARCH-019 SEC conditions) | Locksmith | S | ✅ | Murphy PRs in review (Day 3+) |
| S9-TST-01 | Backend route test coverage — all new routes | Scout | M | 🟡 | Murphy PRs open (Day 3+) |
| S9-TST-02 | Safari/cross-browser animation pass — Neural Expressive layer | Scout | S | 🟡 | S9-FE-01 stable (Day 6+) |
| S9-DOC-01 | ARCH-019 Clarence archive pass (frontmatter, tags, cross-references) | Clarence | XS | ✅ | None |
| S9-DOC-02 | Sprint 9 meeting minutes (this document) | Clarence | XS | ✅ | None |

---

## Decisions Made This Session

### D1 — S9-BE-00: `active_task_count` added to `GET /api/agents`

ARCH-019 excluded existing routes from pagination retrofit. Adding a computed JOIN field is a controlled exception, logged in the PR description. Silas-approved SQL:

```sql
SELECT a.slug, a.display_name, a.active, a.updated_at, a.last_used_at,
       COALESCE(COUNT(t.id) FILTER (
           WHERE t.status IN ('todo','wip','review','rework')
       ), 0)::int AS active_task_count
  FROM agents a
  LEFT JOIN tasks t ON t.assignee_agent_slug = a.slug
 GROUP BY a.slug, a.display_name, a.active, a.updated_at, a.last_used_at
 ORDER BY a.active DESC, a.slug ASC
```

**Locksmith SEC-C6 binding:** `active_task_count` must use LEFT JOIN, COALESCE to 0 (never null), status IN hardcoded allowlist.

---

### D2 — S9-FE-03: AgentRegistryView = Option A (replace, not duplicate)

Nova flagged ~85% overlap between proposed AgentRegistryView and existing AgentsView.vue. Resolution confirmed per Pre-S9A intent: **AgentRegistryView.vue replaces AgentsView.vue.** The existing file is enhanced with ethos data (seal chip + manifest role) and renamed. Router path `/agents` stays the same. No second component. No duplicate.

---

### D3 — Nova timing flags DISMISSED

Nova flagged `GET /api/agents/:slug` and `GET /api/sops` as Sprint 10 scope per ARCH-019 wording. **Dismissed.** ARCH-019 uses "Sprint 10" to describe when Rocket builds the *views* consuming these routes. Murphy building the routes in Sprint 9 is explicit Pre-S9A intent (memory id 1983) and confirmed in Pre-S9B. No hold.

---

### D4 — S9-FE-05 Nav Enumeration (resolved, no Richo input required)

Silas flagged S9-FE-05 as blocked pending 7-section route enumeration. Resolved from Pre-S9A planning (memory id 1983):

| # | Section | Route | S9 State |
|---|---|---|---|
| 1 | Dashboard | `/` | ✅ Active |
| 2 | Inbox | `/inbox` | ✅ Active |
| 3 | Agent Registry | `/agents` | ✅ Active |
| 4 | Agents (detail) | `/agents/:slug` | 🔒 Disabled (Sprint 10) |
| 5 | SOPs | `/sops` | 🔒 Disabled (Sprint 10) |
| 6 | Projects | `/projects` | 🔒 Disabled (Sprint 10/11) |
| 7 | Org Chart | `/org` | 🔒 Disabled (Sprint 12+) |

Disabled sections: rendered as `<span aria-disabled="true" tabindex="-1">` with "coming soon" treatment. Not `<RouterLink>`. No fake routes registered.

---

### D5 — `/health` response shape (canonical, from Silas)

| Field | Type | Signal |
|---|---|---|
| `status` | `'ok'` \| `'degraded'` | Top-level |
| `db` | `'connected'` \| `'error'` | DB state |
| `schema` | `'ok'` \| `'degraded'` | Migration integrity |
| `missing_tables` | `string[]?` | When schema = degraded |
| `error` | `string?` | When db = error |

HTTP 200 = green. HTTP 503 = amber (Rocket inspects `missing_tables` for tooltip). Fetch fail = red.

Murphy documents this in `docs/openapi.yaml` on Day 1.

---

### D6 — New Locksmith Conditions (SEC-C6, SEC-C7)

**SEC-C6 (S9-BE-00):** `active_task_count` must use LEFT JOIN, COALESCE to integer 0, hardcoded status IN list. Murphy follows SQL pattern in D1 above.

**SEC-C7 (S9-BE-03):** `VALID_CATEGORIES` must be declared as a `const` named constant in the route file, not an inline array literal. Makes it grep-auditable.

Both are binding merge gates.

---

### D7 — squad-dashboard zombie tasks: close as superseded

Nova confirmed tasks #242–245 in squad-dashboard are zombie tasks. The project is deprecated per ARCH-004 Decision 3A. All four tasks superseded by OpenHiveOS Sprint 9:
- #242 Deploy to hosting → superseded by ARCH-012 serve-from-squad-api
- #243 Agent accountability detail pages → superseded by S9-FE-03 + Sprint 10 Agent Detail
- #244 Favicon/page titles → in scope for Rocket Sprint 9 (quality pass Day 9-10)
- #245 Live task data feed evaluation → answered: OpenHiveOS InboxView is the implementation

**Action: Elizabeth closes tasks #242–245 in squad-dashboard board.**

---

## Dependency Sequence

```
DAY 1 (May 26)
├── Murphy: openapi.yaml /health entry (30min) → UNBLOCKS Rocket StatusAura
├── Murphy: S9-BE-00 (agents active_task_count, 1.5h) → UNBLOCKS S9-FE-03, S9-FE-02 Zone 2
├── Murphy: S9-BE-02 (GET /api/agents/:slug, 2h)
├── Rocket: S9-FE-00 primitives except StatusAura → starts immediately
├── Cooper: S9-OPS-01 → starts immediately
└── Clarence: S9-DOC-01, S9-DOC-02 → starts immediately

DAY 2 (May 27)
├── Murphy: S9-BE-03 (GET /api/sops, 3h)
├── Rocket: S9-FE-01 Neural Expressive (health strip finalised after Day 1 Murphy commit)
└── Rocket: S9-FE-03 shell + static layout → wires live after S9-BE-00 merges

DAY 3 (May 28) — GATE DAY
├── Murphy: S9-BE-01 (GET /api/tasks, 3h) — GATE OPENS
├── Locksmith: S9-SEC-01 begins (first Murphy PR in review)
├── Scout: S9-TST-01 begins (first Murphy PR in review)
└── Rocket: S9-FE-04 InboxView — opens ONLY on Murphy Day 3 confirmation

DAYS 4–5
├── Murphy: S9-BE-04 STRETCH (only if S9-BE-01/02/03 all green)
├── Rocket: S9-FE-02 DashboardView (live data wired after Murphy PRs land)
└── Scout: S9-TST-01 continues

DAYS 5–7
├── Rocket: S9-FE-02 DashboardView (complete)
└── Rocket: S9-FE-05 AppSidebar (7-section nav)

DAYS 7–9
├── Scout: S9-TST-02 Safari animation pass (after S9-FE-01 stable)
└── All PRs: Locksmith S9-SEC-01 merge gate cleared

DAYS 9–10 (buffer)
└── Cross-browser verification, Safari box-shadow animation pass, coverage report
```

**Critical path:**
$$\text{Murphy S9-BE-01 (Day 3)} \rightarrow \text{Rocket S9-FE-04 InboxView} \rightarrow \text{Sprint close}$$

**No circular dependencies.** Locksmith is a merge gate (not a start gate) for all backend routes.

---

## Backlog Refinement List

| Story | Status | What's Missing | Owner | Target |
|---|---|---|---|---|
| S9-FE-04 InboxView | 🟡 Conditional (not removed) | Murphy S9-BE-01 must be in REVIEW by Day 3. If not, InboxView defers to Sprint 10 cleanly. | Elizabeth monitors | Day 3 gate |
| S9-BE-04 GET /api/thoughts | 🟡 Stretch | All three committed routes green. Only enters sprint formally after Day 3. | Murphy | Day 4+ |
| Sprint 10 pre-planning | 🔴 Required before S10 opens | OQ-2: Extend `squad.manifest.json` with `skills[]`, `owns[]`, `works_with[]`. Murphy + Silas. Must close before Sprint 10 Day 1. | Silas + Murphy | Pre-Sprint 10 |

---

## Technical Debt Flagged

| ID | Item | Sprint | Owner |
|---|---|---|---|
| TD-S9-01 | `GET /api/agents` tasks JOIN — no growth guard. Risk at ~50K tasks rows. | Sprint 12+ | Silas design, Murphy implements |
| TD-S9-02 | OQ-2 manifest format debt — compounds each sprint without resolution | **Pre-Sprint 10 hard gate** | Silas + Murphy |
| TD-S9-03 | `/health` not in openapi.yaml (pre-existing) | **Sprint 9 Day 1** | Murphy |
| TD-S9-04 | `GET /api/sops` display_name derived per-request — risk at ~5K SOPs | Sprint 11 | Silas |
| TD-S9-05 | No Route Evolution Policy for controlled exceptions to ARCH-019 | Sprint 10 backlog | Silas |

---

## Risk Register

| Risk | Severity | Mitigation |
|---|---|---|
| Murphy S9-BE-01 slips past Day 5 | Medium | InboxView gated cleanly; DashboardView Zone 3 renders EmptyState |
| Safari `box-shadow` frame drop in scroll container | Medium | Rocket tests Day 3; fallback to `filter: drop-shadow` or `outline` if needed |
| `GET /api/agents` missing `last_used_at` at runtime | LOW (confirmed already present in existing route) | `last_used_at` already in `AGENTS_SQL` — no work needed |
| Safari exit transition drop on route change | Low | `mode="out-in"` on all `<Transition>` wrappers |
| Manifest OQ-2 not resolved before Sprint 10 | High | Silas + Murphy pre-Sprint 10 session is a hard gate — flagged in Backlog Refinement List |

---

## Action Items

- [ ] Murphy: Document `/health` in `docs/openapi.yaml` — **Day 1 (May 26)**
- [ ] Murphy: S9-BE-00 agents active_task_count — follows Locksmith SEC-C6 SQL — **Day 1**
- [ ] Murphy: Read ARCH-019 SEC conditions table directly (Locksmith note: numbering in planning prompt summary has minor discrepancy vs ADR table) — **before writing first route**
- [ ] Rocket: Confirm DashboardView Zone 2 agent roster is strip/preview (3–5 condensed), not a full table — **Day 1**
- [ ] Rocket: `mode="out-in"` on all `<Transition>` wrappers from Day 1 — **non-negotiable**
- [ ] Rocket: Build all views against mock data from Day 1; swap to live endpoints when Murphy PRs land — **sprint discipline**
- [ ] Scout: S9-TST-01 include zero-task agent test (active_task_count must return `0`, not `null`) — **Day 3**
- [ ] Scout: S9-TST-02 brief: animation behaviour belongs in cross-browser matrix, not CI assertions — **Day 6+**
- [ ] Elizabeth: Close squad-dashboard zombie tasks #242, #243, #244, #245 — **before May 26**
- [ ] Cooper: S9-OPS-01 — confirm clean install and dashboard build before Day 2 EOD
- [ ] Silas + Murphy: Pre-Sprint 10 session date confirmed before Sprint 9 Day 5 — **to resolve OQ-2**
- [ ] All agents: Tag Locksmith when any backend route PR is ready for review — **merge gate, 24h SLA**

---

## Pre-S9A / Pre-S9B Gate Status

| Gate | Status |
|---|---|
| Pre-S9A dashboard product strategy (Rocket + Nova + Meridian + Elizabeth) | ✅ Closed 2026-05-23 |
| Pre-S9B architecture session (Silas + Murphy + Elizabeth) → ARCH-019 | ✅ Closed 2026-05-23 |
| OQ-1 resolved (tasks table) | ✅ |
| OQ-3 resolved (projects table) | ✅ |
| ARCH-019 filed | ✅ |
| Sprint 9 planning | ✅ This document |

**Sprint 9 is open. Day 1: May 26, 2026.**
