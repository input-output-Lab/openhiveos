---
title: "ARCH-019 — Sprint 9 Squad-API Read Surface: Contracts, Pagination, and Agent Relationship Model"
date: 2026-05-23
status: Decided
decision_owner: Silas
approved_by: Elizabeth
filed_by: Silas
authored_by: Silas
adr: ARCH-019
related: ARCH-012, ARCH-013, ARCH-015, ARCH-018
sprint: "9B"
tags:
  - type/adr
  - project/openhiveos
  - domain/architecture
  - domain/backend
  - domain/security
  - audience/technical
review_date: 2026-08-23
---

# ARCH-019 — Sprint 9 Squad-API Read Surface: Contracts, Pagination, and Agent Relationship Model

**Date:** 2026-05-23
**Project:** OpenHiveOS
**Status:** Decided — binding from 2026-05-23
**Decision Owner:** Silas
**Approved By:** Elizabeth
**Session:** Pre-Sprint 9B Architecture Review
**Implements:** Locks API surface for Sprint 9 Murphy deliverables (A1) and Sprint 10 pre-work contracts (A2, A3, B, D)
**Related:** ARCH-012 (squad-api service architecture), ARCH-015 (LLM usage routes), ARCH-018 (ethos extension)

---

## Context

Sprint 9 delivers three new squad-api routes for the dashboard Inbox view. Sprint 10 builds Agent Detail, SOPs view, and Projects view on top of those contracts. Rocket builds the frontend against these shapes — any mid-sprint retrofit is a sprint-velocity loss attributed to this session.

The existing squad-api routes (`GET /health`, `GET /api/ethos-seal`, `GET /api/agents`, `GET /api/usage/*`) were designed individually without a shared pagination standard. As new list routes are added this sprint and next, inconsistent pagination across endpoints will force Rocket to write bespoke fetch logic for every view. That cost is paid now by deciding once.

The agent relationship model is the critical architectural decision that unblocks both the Agent Detail view (Sprint 10) and the Org Chart feature (Sprint 11+). Resolving it now prevents a mid-Sprint 10 schema/manifest change that would break Rocket's in-progress component.

> **Codebase grounding note:** The prompt referencing `factory_tasks` and `factory_projects` uses the openSquad MCP legacy naming convention. The OpenHiveOS canonical schema (migration 002) defines these as `tasks` and `projects`. The `factory_*` prefix is a cross-system artifact from the pre-consolidation era. All SQL in this ADR uses OpenHiveOS canonical names. See **OQ-1** for the resolution gate.

---

## Security Conditions (Merge Gates)

The following security conditions are binding. No PR touching a route defined in this ADR merges without the associated condition being met. Locksmith review is required for any condition marked **NEW**.

| ID | Condition | Status | Applies To |
|---|---|---|---|
| **SEC-A5** | All queries run via `openhiveos_reader` (SELECT-only) enforced by `withReaderRole()` | Existing — ARCH-012 | All routes |
| **SEC-A6** | No token columns (`token_hash`, `token_salt`) in any response | Existing — ARCH-012 | All routes |
| **SEC-B1** (NEW) | `embedding` vector column is never selected in any thoughts query | This ADR | `GET /api/thoughts` |
| **SEC-B2** (NEW) | `GET /api/thoughts` validates `agent` param against `agents.slug` existence before querying — no bare string interpolation | This ADR | `GET /api/thoughts` |
| **SEC-B3** (NEW) | `GET /api/thoughts` excludes `raw_behavior` and `expressed_behavior` from list response — verbatim internal reasoning is not surfaced in the listing surface | This ADR | `GET /api/thoughts` |
| **SEC-C1** (NEW) | `limit` param on all list routes is clamped to `[1, 100]` at the handler layer. Values outside this range return HTTP 400 — not silently clamped | This ADR | All paginated routes |
| **SEC-C2** (NEW) | `offset` param on all list routes is validated as a non-negative integer. Non-integer or negative values return HTTP 400 | This ADR | All paginated routes |
| **SEC-C3** (NEW) | `status` filter params are validated against a named constant allowlist before interpolation into the `ORDER BY` clause or `WHERE` clause. OWASP A03 — parameterised queries only | This ADR | `GET /api/tasks`, `GET /api/projects` |
| **SEC-C4** (NEW) | `GET /api/agents/:slug` returns HTTP 404 (not 500) for slugs not found in the `agents` table. Must not leak existence of other slugs in error messages | This ADR | `GET /api/agents/:slug` |
| **SEC-C5** (NEW) | Manifest enrichment for `GET /api/agents/:slug` reads `squad.manifest.json` at startup (not per-request). File is loaded once and cached in memory. No user-supplied path traversal is possible | This ADR | `GET /api/agents/:slug` |
| **SEC-C6** (NEW — Sprint 9 planning, Locksmith ruling 2026-05-23) | `GET /api/agents` `active_task_count` field: must use LEFT JOIN (never INNER JOIN), COALESCE result to integer 0 (never null), status filter via `FILTER (WHERE t.status IN ('todo','wip','review','rework'))` hardcoded allowlist only | Locksmith Sprint 9 planning review | `GET /api/agents` |
| **SEC-C7** (NEW — Sprint 9 planning, Locksmith ruling 2026-05-23) | `GET /api/sops` `category` allowlist must be declared as a named TypeScript constant (`const VALID_CATEGORIES = [...] as const`) in the route file — not an inline array literal. Required for grep-auditability and future policy extension without behavior change | Locksmith Sprint 9 planning review | `GET /api/sops` |
| **SEC-S9-01** (NEW — Locksmith S9-SEC-01 ruling 2026-05-23) | Wherever a TypeScript named allowlist const (e.g. `ACTIVE_TASK_STATUSES`, `VALID_TASK_STATUSES`) has a parallel hardcoded SQL `IN`-list in the same file, a `// SEC-S9-01:` comment is required immediately before the SQL block, explicitly documenting that the IN-list must be kept in sync with the const manually (TypeScript cannot interpolate a const into a SQL string literal). Applied to: `agents.ts` (`ACTIVE_TASK_STATUSES`). Note: `SEC-D1` through `SEC-D11` are reserved by ARCH-016 (MCP Gateway auth). | Locksmith S9-SEC-01 route review | All routes with a named allowlist const + parallel SQL IN-list |

---

## Decision E — Pagination Model (Standard Across All List Routes)

### Decision

**Model: offset + limit with `has_more` boolean. No `total` count.**

All new list endpoints use a consistent envelope:

```json
{
  "data": [ /* T[] */ ],
  "meta": {
    "limit": 25,
    "offset": 0,
    "has_more": false
  }
}
```

**Parameters:**

| Param | Type | Default | Max | Notes |
|---|---|---|---|---|
| `limit` | integer | `25` | `100` | SEC-C1: values outside [1, 100] → HTTP 400 |
| `offset` | integer | `0` | none | SEC-C2: negative or non-integer → HTTP 400 |

`has_more` is computed by querying `LIMIT (limit + 1)` rows and testing whether the result count exceeds `limit`. The extra row is never returned to the client. This avoids a `COUNT(*)` subquery on every list request.

**Alternatives ruled out:**

- *Cursor-based pagination:* Appropriate for high-volume, high-velocity tables (>100K rows, live inserts during pagination). Squad dashboard tables at current scale are single-digit thousands at peak. Cursor logic adds 3× implementation complexity for no measurable benefit. Revisit if any table exceeds 50K rows.
- *Total count included:* Requires a `COUNT(*)` query on every list call. Internal tooling does not need precise page counts for "Page 3 of 47" UX — a "Load More" / next-page pattern is sufficient.
- *Simple limit-only (no offset, no has_more):* Prevents backward navigation and provides no signal for "there is more data." Ruled out because Agent Detail Reasoning Ledger (Sprint 10) needs at least two pages of thoughts.

**Retrofit scope:** Existing routes (`GET /api/agents`, `GET /api/usage/agents`, `GET /api/usage/agents/:name`, `GET /api/usage/tasks/:id`) are **NOT retrofitted**. They retain their current response shapes. This standard applies to all routes first implemented after this ADR.

---

## Decision A1 — `GET /api/tasks` (Inbox View)

### Decision

**Route:** `GET /api/tasks`
**DB source:** `tasks` table joined with `projects` for `project_slug` *(see OQ-1)*
**Auth:** Existing `authMiddleware` (bearer token — ARCH-012 SEC-A1/A2)
**DB role:** `openhiveos_reader` via `withReaderRole()` (SEC-A5)

**Query parameters:**

| Param | Type | Default | Allowed values |
|---|---|---|---|
| `status` | string | none (all statuses) | `todo`, `wip`, `review`, `done`, `rework` |
| `assigned_agent` | string | none (all agents) | any valid `agents.slug` |
| `project_id` | integer | none (all projects) | any positive integer |
| `limit` | integer | `25` | 1–100 (SEC-C1) |
| `offset` | integer | `0` | ≥ 0 (SEC-C2) |

SEC-C3: `status` is validated against `['todo', 'wip', 'review', 'done', 'rework']` before use in a parameterised query clause.

**Response shape:**

```json
{
  "data": [
    {
      "id": 42,
      "title": "Build UsageView component",
      "status": "todo",
      "assignee_agent_slug": "rocket",
      "project_id": 3,
      "project_slug": "openhiveos",
      "github_pr_url": null,
      "notes": null,
      "created_at": "2026-05-23T10:00:00.000Z",
      "updated_at": "2026-05-23T10:00:00.000Z"
    }
  ],
  "meta": {
    "limit": 25,
    "offset": 0,
    "has_more": false
  }
}
```

**Field notes:**
- `assignee_agent_slug`: matches the canonical column name in the `tasks` schema (migration 002). The prompt used `assigned_agent` — this ADR corrects it to the actual column name. **Rocket must use `assignee_agent_slug` in the component.**
- `project_slug` is derived by joining `projects` on `project_id`. This is the human-readable project identifier, not just the numeric FK. Required for the Inbox view grouping header.
- `description` is excluded from the list response. It is a long-form field (same class as `instruction` in SOPs). If needed for a task detail modal, it belongs on a future `GET /api/tasks/:id` route (not scoped in this ADR).
- `notes` is included — short free-form field used by agents during status updates. Acceptable list payload weight.

**OQ-1 RESOLVED (Murphy, Pre-S9B 2026-05-23):** MCP agent tools write to `factory_tasks` (opensquad-mcp-server layer). The OpenHiveOS canonical `tasks` table (migration 002) is the correct read target for the dashboard. These are the same PostgreSQL instance but distinct tables — no data consolidation migration is required. Implementation may proceed against `tasks`. This was a zero-tolerance ambiguity — implementing against the wrong table means the dashboard inbox shows zero rows in production.

---

## Decision A2 + C — `GET /api/agents/:slug` (Agent Detail) + Agent Relationship Model

### Decision C — Agent Relationship Model

**The DB is the authoritative source for runtime state. `squad.manifest.json` is the authoritative source for static agent definition. Neither source is duplicated in the other. `GET /api/agents/:slug` composites both at the application layer.**

Rationale: runtime state (active, last_used_at, updated_at) changes on every agent invocation — it belongs in the DB where it can be updated transactionally. Static definition (role, skills, owns, works_with) is operator-configured and version-controlled — it belongs in the manifest where it travels with the codebase and is not subject to database drift.

Duplicating role/skills into the DB (Option: DB-only) would create two sources of truth for the same fact and introduce a class of drift bugs (manifest says "Frontend Developer", DB says "Frontend Dev"). Serving everything from the manifest (Option: manifest-only) loses runtime state and requires a migration to add columns that belong in a live-data table.

**Agent identity reads:** `GET /api/agents` (list) continues to read from DB only — it does not need the manifest enrichment. The composite is scoped to the detail endpoint only.

**Manifest loading:** `squad.manifest.json` is loaded once at `server.ts` startup and held in memory (SEC-C5). It is not re-read per request. A server restart is required to pick up manifest changes. This is acceptable for operator-configured static data.

**Manifest format extension prerequisite:** The current `squad.manifest.json` only contains `slug`, `name`, `role`. The `skills`, `owns`, and `works_with` fields are not yet defined. This format must be extended before the Sprint 10 Agent Detail build begins. **This is a Murphy + Silas pre-Sprint 10 action item — not Sprint 9 scope.** Murphy must not start `GET /api/agents/:slug` implementation until the manifest format is locked (see OQ-2).

### Decision A2 — Route Contract

**Route:** `GET /api/agents/:slug`
**DB source:** `agents` table
**Manifest source:** `squad.manifest.json` (startup-cached)
**Auth:** Existing `authMiddleware` (SEC-A1/A2)
**DB role:** `openhiveos_reader` via `withReaderRole()` (SEC-A5)

**Response shape:**

```json
{
  "agent": {
    "slug": "rocket",
    "display_name": "Rocket",
    "active": true,
    "last_used_at": "2026-05-23T10:00:00.000Z",
    "updated_at": "2026-05-23T10:00:00.000Z",
    "manifest": {
      "role": "Frontend Developer",
      "skills": ["component-build", "mobile-first-css", "accessibility-audit"],
      "owns": ["packages/dashboard"],
      "works_with": ["murphy", "silas", "elizabeth"]
    }
  }
}
```

**Error states:**

| Condition | HTTP status | Body |
|---|---|---|
| `slug` not found in `agents` table | `404` | `{ "error": "Agent not found" }` |
| `slug` found in DB but absent from manifest | `200` | `manifest` key is `null` — agent is provisioned but not in the current manifest version |
| DB unavailable | `500` | `{ "error": "Internal server error" }` |

SEC-C4: the 404 response does not enumerate which slugs ARE valid.

**Field notes:**
- `token_hash`, `token_salt` excluded per SEC-A6 (as with all agents routes).
- `manifest.works_with` is an array of slugs, not resolved agent objects. Circular resolution (resolving each `works_with` slug to its own agent object) is not in scope and creates an N+1 query risk.
- `manifest` being `null` is a valid production state during a manifest roll-forward. The dashboard must handle it gracefully (render the DB fields only, suppress the manifest section).

**Open question OQ-2 (BLOCKING for Sprint 10, not Sprint 9):** Silas and Murphy must co-author the extended `squad.manifest.json` format (adding `skills`, `owns`, `works_with` arrays to each agent entry) before the Sprint 10 Agent Detail build begins. Clarence archives the format decision as an addendum to this ADR. Rocket must not build the Agent Detail component until OQ-2 is resolved.

---

## Decision A3 — `GET /api/sops` (SOPs View)

### Decision

**Route:** `GET /api/sops`
**DB source:** `sops` table (migrations 001 + 008)
**Auth:** Existing `authMiddleware` (SEC-A1/A2)
**DB role:** `openhiveos_reader` via `withReaderRole()` (SEC-A5)

**Critical constraint:** The `sops` table has **no `title` column**. The `source_path` column (e.g., `/Users/richo/.copilot/skills/mobile-first-css/SKILL.md`) is the closest stable identifier. Murphy must derive a display label from `source_path` at the application layer (filename stem without extension, replacing hyphens with spaces and title-casing). This derivation is applied server-side before the response is serialised.

**Query parameters:**

| Param | Type | Default | Notes |
|---|---|---|---|
| `category` | string | none (all categories) | Validated against `['Coding', 'DevOps', 'QA', 'Architecture', 'Documentation', 'Decision']` (SEC-C3) |
| `agent` | string | none (all agents) | Optional filter by `sops.agent` column |
| `source_namespace` | string | none | `core` or `operator` — from migration 008 |
| `limit` | integer | `25` | 1–100 (SEC-C1) |
| `offset` | integer | `0` | ≥ 0 (SEC-C2) |

**Response shape:**

```json
{
  "sops": [
    {
      "id": 14,
      "source_path": "/Users/richo/.copilot/skills/mobile-first-css/SKILL.md",
      "display_name": "mobile-first-css",
      "category": "Coding",
      "agent": "rocket",
      "preview": "Mobile-first CSS authoring discipline for IO Labs projects. Use when writing layout, responsive styles, or Tailwind utilities.",
      "created_at": "2026-05-01T00:00:00.000Z",
      "updated_at": "2026-05-23T10:00:00.000Z"
    }
  ],
  "pagination": {
    "limit": 25,
    "offset": 0,
    "has_more": false
  }
}
```

**Field notes:**
- `display_name` is a server-derived field (not a DB column). It is produced by `basename(source_path, '.md')` — the filename stem of the last path segment, with the `.md` extension stripped. No title-casing is applied server-side; Rocket handles display formatting. Example: `mobile-first-css/SKILL.md` → `"mobile-first-css"`. Null `source_path` → empty string `""`.
- `preview` is the first 200 characters of `instruction` (`LEFT(instruction, 200)`). The full `instruction` text is **excluded** — it is the embedding target (often 2–20 KB). Full text belongs on a future `GET /api/sops/:id` detail route (Sprint 11 scope).
- `instruction` is excluded from the list response (see above). `embedding` vector is never selected (SEC-B1 analogue).
- `content_hash` (migration 008) is excluded — internal integrity field, not a dashboard concern.
- Response envelope uses `sops` / `pagination` keys (ARCH-019 ARCH-019 standard envelope). NOT `data` / `meta`.
- Order: `category ASC, source_path ASC` by default. Rocket may implement client-side sort on `display_name`.

---

## Decision B — `GET /api/thoughts` (Agent Detail Reasoning Ledger)

### Decision

**Route:** `GET /api/thoughts`
**DB source:** `thoughts` table (migration 001)
**Auth:** Existing `authMiddleware` (SEC-A1/A2)
**DB role:** `openhiveos_reader` via `withReaderRole()` (SEC-A5)

**Query parameters:**

| Param | Type | Default | Notes |
|---|---|---|---|
| `agent` | string | none (all agents) | Validated against `agents.slug` existence before query (SEC-B2) |
| `thought_type` | string | none (all types) | Validated against `['analysis', 'concern', 'decision', 'hypothesis', 'realization', 'pushback']` (SEC-C3) |
| `must_surface` | boolean | none | `true` or `false`. Invalid values → HTTP 400 |
| `session_id` | string | none | Exact match filter. Enables session replay view in Agent Detail |
| `limit` | integer | `25` | 1–100 (SEC-C1) |
| `offset` | integer | `0` | ≥ 0 (SEC-C2) |

**Response shape:**

```json
{
  "data": [
    {
      "id": 87,
      "agent_slug": "silas",
      "thought": "The N+1 pattern in the leads query costs ~40ms at current load...",
      "thought_type": "concern",
      "confidence": 0.9,
      "must_surface": true,
      "auto_persist_candidate": false,
      "ratified_by": null,
      "ratified_at": null,
      "auto_persisted": false,
      "counter_thought": null,
      "session_id": "silas:session-abc:1716458400000",
      "task_id": 42,
      "metadata": {},
      "created_at": "2026-05-23T10:00:00.000Z"
    }
  ],
  "meta": {
    "limit": 25,
    "offset": 0,
    "has_more": false
  }
}
```

**Field exclusions (binding):**

| Field | Reason for exclusion |
|---|---|
| `embedding` | SEC-B1: vector column never exposed via API |
| `raw_behavior` | SEC-B3: verbatim internal agent reasoning. Not surfaced in list view. Detail route (future) may include with Locksmith review |
| `expressed_behavior` | SEC-B3: same class as `raw_behavior` |
| `disposition_snapshot` | JSONB blob. Verbose at list scale (~200 bytes/row × 25 rows). Reserved for a future `GET /api/thoughts/:id` detail route (Sprint 11 scope) |

**Default ordering:** `created_at DESC` — newest thought first. Consistent with the Reasoning Ledger UX intent (most recent reasoning visible immediately).

**Rationale for `session_id` filter inclusion:** The Agent Detail Reasoning Ledger feature requires grouping thoughts by session (to show a session replay view). Providing `session_id` as a filter parameter at the route level avoids a second round-trip for the session-grouped view.

---

## Decision D — `GET /api/projects` (Projects View)

### Decision

**Route:** `GET /api/projects`
**DB source:** `projects` table *(see OQ-3)*
**Auth:** Existing `authMiddleware` (SEC-A1/A2)
**DB role:** `openhiveos_reader` via `withReaderRole()` (SEC-A5)

**Query parameters:**

| Param | Type | Default | Allowed values |
|---|---|---|---|
| `status` | string | `active` | `active`, `archived` |
| `limit` | integer | `25` | 1–100 (SEC-C1) |
| `offset` | integer | `0` | ≥ 0 (SEC-C2) |

**Response shape — using OpenHiveOS canonical schema (migration 002):**

```json
{
  "data": [
    {
      "id": 3,
      "slug": "openhiveos",
      "name": "OpenHiveOS",
      "description": "The agent operating system...",
      "status": "active",
      "owner_agent_slug": "silas",
      "created_at": "2026-05-01T00:00:00.000Z",
      "updated_at": "2026-05-23T10:00:00.000Z"
    }
  ],
  "meta": {
    "limit": 25,
    "offset": 0,
    "has_more": false
  }
}
```

**Default ordering:** `status ASC` (active before archived), then `name ASC`.

**OQ-3 RESOLVED (Murphy, Pre-S9B 2026-05-23):** Same resolution pattern as OQ-1. MCP tools write to `factory_projects` (opensquad-mcp-server layer). The dashboard reads from the OpenHiveOS canonical `projects` table (migration 002) which carries `owner_agent_slug` (not `lead_agent`). The response shape above reflects the canonical columns. No consolidation migration is required — the tables serve distinct purposes and both are correct in their domain.

---

## Summary: Murphy's Pre-Implementation Checklist

Before writing a single line of route code for any of these endpoints, Murphy must resolve:

| # | Question | Blocks | Owner |
|---|---|---|---|
| **OQ-1** | ~~Which table do MCP agent tools write tasks to?~~ | ✅ **RESOLVED 2026-05-23** — read target is `tasks` (OpenHiveOS canonical). MCP writes to `factory_tasks` (separate concern). | Murphy (Pre-S9B) |
| **OQ-2** | ~~`squad.manifest.json` format extension (`skills`, `owns`, `works_with`) locked and merged~~ | ✅ **RESOLVED 2026-05-23** — ARCH-020 filed. `squad.manifest.json` bumped to v1.1.0. All 9 agents extended with `skills[]`, `owns[]`, `works_with[]`. Manifest-first ruling (Murphy + Silas). Sprint 10 Agent Detail build unblocked. | Murphy + Silas |
| **OQ-3** | ~~Which table holds live project data?~~ | ✅ **RESOLVED 2026-05-23** — read target is `projects` (OpenHiveOS canonical). MCP writes to `factory_projects` (separate concern). | Murphy (Pre-S9B) |

All open questions resolved. Sprint 10 is unblocked.

---

## Alternatives Ruled Out

**Cursor-based pagination (all list routes):** Appropriate at high data velocity (>100K rows, live inserts during scroll). Squad dashboard tables at current scale are single-digit thousands peak. Cursor complexity is not justified. Revisit condition: any single list table exceeds 50K rows at P95 query time > 100ms.

**DB-only agent detail (no manifest join):** Would require duplicating `role`, `skills`, `owns`, `works_with` into the `agents` table. Two sources of truth for static definition → drift risk → synchronisation bugs. Ruled out.

**Manifest-only agent detail:** Loses runtime state (`active`, `last_used_at`). The agent card in the dashboard needs liveness signal — when did Rocket last run? Manifest cannot answer that. Ruled out.

**Including `instruction` in SOPs list:** At 2–20 KB per SOP, a 25-row response is 50–500 KB. Unacceptable for a listing API. Full text belongs on a detail endpoint only.

**Including `disposition_snapshot` in thoughts list:** 200 bytes × 25 rows per page = 5 KB/page. Marginal at list scale but the field is verbose JSONB with no filtering utility at list view. Reserved for detail endpoint.

---

## Trade-offs Accepted

- The `has_more` pagination model provides no total count. Rocket cannot render "Showing 25 of 847 thoughts." The Reasoning Ledger will show a "Load More" affordance only. If a count is needed in a future sprint, a `GET /api/thoughts/count` endpoint is the correct addition — not retrofitting `meta.total` here.
- `label` in SOPs list is server-derived from `source_path`. If a SOP has a `null` `source_path`, the label falls back to `"SOP #<id>"`. This is an acceptable edge case at current ingest rates.
- Loading `squad.manifest.json` at startup means agent manifest changes require a container restart. At current operator-controlled change frequency (manifest changes are infrequent, intentional, and deploy-gated), this is not a constraint in practice.

---

## Revisit Conditions

- Cursor-based pagination becomes the default if any list table exceeds 50K rows or if P95 response time for a list route exceeds 100ms under load.
- The manifest enrichment model is revisited if `skills`, `owns`, or `works_with` become user-mutable at runtime (currently: operator-configured, deploy-gated, static).
- If OQ-1 / OQ-3 resolution reveals that `tasks` and `factory_tasks` coexist with different datasets, a data consolidation migration is required and this ADR must be re-opened before any route implementation proceeds.

---

## ADR archived by: Clarence (pending)

---

## Session Record — Pre-S9B (2026-05-23)

**Attendees:** Silas (lead), Murphy, Elizabeth

**OQ-1 + OQ-3 resolved:** Murphy confirmed that `factory_tasks` / `factory_projects` belong to the opensquad-mcp-server layer. The OpenHiveOS canonical tables (`tasks`, `projects`) are the correct read targets for all dashboard routes. No data consolidation migration required.

**Schema corrections confirmed (Murphy audit):**

| Brief (wrong) | OpenHiveOS canonical |
|---|---|
| `factory_tasks` | `tasks` |
| `factory_projects` | `projects` |
| `tasks.assigned_agent` | `tasks.assignee_agent_slug` |
| `projects.lead_agent` | `projects.owner_agent_slug` |
| `agent_thoughts` | `thoughts` |
| `thoughts.agent_name` | `thoughts.agent_slug` |
| `sops.title` | Does not exist — `display_name` derived from `source_path` |
| `manifest.skills[]`, `manifest.owns[]`, `manifest.works_with[]` | Do not exist — manifest has `slug`, `name`, `role` only |

**Murphy Sprint 9 capacity confirmed (8h committed, 11h with stretch):**

| Route | Hours | Gate |
|---|---|---|
| `GET /api/tasks` | 3h | Day 3 — Rocket InboxView depends on this |
| `GET /api/agents/:slug` (DB + role) | 2h | Unblocked |
| `GET /api/sops` | 3h | Unblocked |
| `GET /api/thoughts` | 3h | Stretch — after Routes 1–3 green |

**Sprint 9 implementation is unblocked. Pre-S9B gate closed.**
