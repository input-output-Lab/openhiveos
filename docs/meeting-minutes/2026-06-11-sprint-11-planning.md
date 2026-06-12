---
title: "Sprint 11 Planning — OpenHiveOS"
date: 2026-06-11
type: meeting-minutes
facilitator: elizabeth
attendees:
  - richo
  - elizabeth
  - murphy
  - rocket
  - silas
  - locksmith
  - clarence
  - cooper
tags:
  - type/meeting-minutes
  - domain/planning
  - project/openhiveos
---

# Sprint 11 Planning — OpenHiveOS

**Date:** 2026-06-11  
**Facilitator:** Elizabeth  
**Sprint Start:** 2026-06-11  
**Sprint End:** 2026-06-25  
**Sprint Number:** 11  
**Health Prediction:** 🟡 Achievable with risk

---

## Sprint Goal

> *Give operators and agents the ability to see, score, and update portfolio value across every project — ROI visible on the board, bubble chart on the projects view, inline edit controls for matrix dimensions, and update_project MCP tool for agent-native scoring.*

---

## Context (Elizabeth)

**Sprint 10 closed clean.** S10-FE-10 Projects Board shipped with WCAG 2.1 AA compliance, Scout sign-off issued. Carryover items: #1732 (cron fix, XS), #1736 (getProjects test, S). Board hygiene performed before planning — tasks #1731, #1734, #1735, #1737 closed.

**Richo decisions made during this session (binding):**
- Value domain: 1/3/5 categorical for all four portfolio matrix fields
- UI pattern: bubble chart as tab toggle on `/projects` (not a new route)
- Auth model: any authenticated agent may update — tool-assignment is the access gate
- Chart placement: confirmed `/projects` tab toggle with URL state (`?view=list` | `?view=chart`)

**Key gap identified:** Portfolio matrix edit UI alone is insufficient. Agents need an MCP tool (`update_project`) to score projects natively without the dashboard. Story S11-BE-03 added during planning.

**Model 3 Correction (private, applied):** Shadow estimate for S11-FE-02 (bubble chart) ran M→L. Repriced before commitment. Shadow estimate for S11-FE-03 (edit form) ran L→XL with Risk Premium. Deferred conditional: if S11-BE-00 is not in REVIEW by Day 3, S11-FE-03 defers to Sprint 12 automatically. No stories negotiated down to absorb overrun.

---

## Decisions Made

| # | Decision | Owner |
|---|---|---|
| D1 | Portfolio matrix fields accept 1/3/5 categorical only. Null = not yet scored. | Richo |
| D2 | ROI score computed on read (`bv × sf ÷ effort`). Never stored. Null if any component missing or effort = 0. | Silas |
| D3 | PATCH /api/projects/:id and `update_project` tool: any authenticated agent may call. No owner restriction. Tool-assignment is the gate. | Richo |
| D4 | Portfolio chart placed as tab toggle on `/projects`. No new route. URL reflects view: `?view=list` (default) / `?view=chart`. Mobile: chart tab hidden, list only. | Richo |
| D5 | Chart library: Chart.js + vue-chartjs (pending Silas S11-ARCH-00 ruling). Bundle impact ~60KB gzip — within 400KB budget. | Silas (Day 1) |
| D6 | Shared DB function `applyPortfolioUpdate()` extracted by Murphy — used by both PATCH endpoint and MCP utility. Eliminates duplication. | Murphy + Silas |

---

## Sprint Stories

| # | Story | Owner | Effort | DoR | Dependencies |
|---|---|---|---|---|---|
| #1743 | S11-ARCH-00: Value domain ruling (1/3/5) + chart library selection | Silas | XS | ✅ | **Day 1 gate — blocks everything else** |
| #1748 | S11-BE-03: `update_project` MCP utility | Murphy | M | ✅ | #1743 |
| #1744 | S11-BE-00: PATCH /api/projects/:id | Murphy | S | ✅ | #1743, #1748 (shared DB fn) |
| #1732 | S11-BE-01: Cron worker query contract fix (last_run_at) | Murphy | XS | ✅ | None |
| #1736 | S11-BE-02: getProjects() integration test | Murphy | S | ✅ | None |
| #1742 | S11-FE-01: ROI score display (ProjectsView + ProjectDetailView) | Rocket | S | ✅ | None |
| #1745 | S11-FE-02: Portfolio bubble chart (tab toggle on /projects) | Rocket | L 🔴 | ✅ | #1743 (library ruling) |
| #1746 | S11-FE-03: Portfolio matrix inline edit form | Rocket | L 🔴 | ✅ (conditional) | #1744 merged + Locksmith gate by Day 4 |
| #1747 | S11-DOC-01: openapi.yaml PATCH /api/projects/:id | Clarence | S | ✅ | #1744 merged |

**Pulled from sprint (DoR failure):**
- #1741 Filter/sort by ROI — URL state architecture not decided, shadow estimate XL vs. team estimate L. Target: Sprint 12.
- #1733 Docker Sunset SPIKE — no capacity justification, not on critical path. Target: Sprint 12+.

---

## Dependency Sequence

```
Day 1
├── Silas: #1743 ARCH record filed (VALUE DOMAIN + CHART LIBRARY)
├── Murphy: #1732 Cron fix (XS, independent)
└── Rocket: #1742 ROI score display (S, independent — no deps)

Day 1–3
├── Murphy: #1748 update_project MCP utility (M, extracts shared DB fn)
└── Rocket: #1745 Bubble chart setup + implementation (L — gated on Silas ruling)

Day 2–3
└── Murphy: #1744 PATCH endpoint (S — wraps shared fn from #1748)

Day 3
└── Murphy: #1736 getProjects integration test (S, independent)

Day 3–4
└── Locksmith: PATCH endpoint + MCP utility security gate

Day 4–8
├── Rocket: #1746 Edit form (L 🔴 — gated on #1744 merged + Locksmith cleared)
└── Clarence: #1747 OpenAPI docs (S — gated on #1744 merged)
```

**Critical path:** Silas Day 1 → Murphy #1748+#1744 Days 1–3 → Locksmith Day 3–4 → Rocket #1746 Days 4–8

---

## Axis Mapping — Bubble Chart

| Visual dimension | Data field | Scale |
|---|---|---|
| X axis | `strategic_fit` | 1 = Low Fit · 3 = Aligned · 5 = Core |
| Y axis | `business_value` | 1 = Low · 3 = Medium · 5 = High |
| Bubble size | `roi_score` | Proportional (min size for null) |
| Bubble colour | `risk_index` | 🟢 1 · 🟡 3 · 🔴 5 |
| Label | `project.name` | Always visible |

---

## Locksmith Gate Criteria (PATCH + MCP utility)

Before either S11-BE-00 or S11-BE-03 may merge:
- [ ] Field allowlist enforced — no mass assignment possible
- [ ] Inputs validated server-side (Zod schema — 1/3/5 categorical only)
- [ ] Parameterised queries only — no string interpolation
- [ ] No sensitive data in error responses (opaque 404 on unknown project)
- [ ] Empty update payload rejected (at least one field required)
- [ ] `squad.manifest.json` `update_project` tool assignment reviewed

---

## Risk Register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| S11-BE-00 slips past Day 3 | Medium | S11-FE-03 defers to Sprint 12 | FE-03 defers cleanly — rest of sprint ships |
| Chart.js integration takes longer than Day 1 | Low | S11-FE-02 loses 1 day | Silas confirms library Day 1; Rocket starts setup immediately |
| Murphy carries 4 stories | Medium | BE-02 defers if needed | BE-02 (test-only) is lowest priority; defers without production impact |
| Cron worker still broken | Low | Not on critical path | #1732 is XS Day 1 — clears immediately |

---

## Day 3 Gate Check (Elizabeth monitors)

At Day 3 standup Elizabeth confirms:
- Is #1744 PATCH endpoint in REVIEW? → If no, #1746 (edit form) defers to Sprint 12
- Is #1745 bubble chart making progress? → If not, escalate to Silas for scope reduction (remove tooltip, simplify to static chart)
- Is #1742 ROI display merged? → If no, identify blocker

---

## Action Items

- [ ] **Silas** — File S11-ARCH-00 ARCH record (value domain 1/3/5 + Chart.js ruling) — **Due: Day 1, June 12**
- [ ] **Murphy** — Begin S11-BE-03 immediately after Silas ruling lands — **Due: Day 1–3**
- [ ] **Murphy** — S11-BE-01 cron fix, Day 1, XS — **Due: June 12**
- [ ] **Rocket** — Begin S11-FE-01 ROI display Day 1 (no deps) — **Due: Day 1–2**
- [ ] **Rocket** — Install chart library only after Silas S11-ARCH-00 filed — **Due: Day 1 (afternoon)**
- [ ] **Locksmith** — Confirm availability for Day 3–4 security gate — **Due: Today**
- [ ] **Elizabeth** — Day 3 gate check standup — **Due: June 14**

---

*Minutes authored by Elizabeth. Sprint 11 locked 2026-06-11 17:31 UTC.*
