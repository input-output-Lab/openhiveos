---
title: "ARCH-020 — Manifest Agent Capability Extension (OQ-2)"
date: 2026-05-23
updated: 2026-05-23
author: murphy
owner: silas
status: active
adr: ARCH-020
related: ARCH-019
sprint: "9"
tags:
  - type/adr
  - project/openhiveos
  - domain/architecture
  - domain/backend
review_date: 2026-08-23
---

# ARCH-020 — Manifest Agent Capability Extension (OQ-2)

**Status:** Accepted  
**Date:** 2026-05-23  
**Participants:** Murphy (Feature Lead), Silas (Systems Architect)  
**Closes:** Open Question OQ-2 (raised in ARCH-019 Sprint 9 session)

---

## Context

`squad.manifest.json` v1.0.0 described each agent with three static fields: `slug`, `name`, `role`.

During ARCH-019 review, OQ-2 was logged: the manifest should be extended to capture agent *capability* and *structural relationships* — specifically:

- **`skills[]`** — which IO Labs skill-library tasks the agent is authorised to execute
- **`owns[]`** — which domains/outcomes the agent is the decision authority for
- **`works_with[]`** — which peer agents the agent routinely collaborates with

These fields are the machine-readable form of the Accountability Chart and the delegation rules defined in each agent's `IDENTITY.md`. Their absence meant the API surface (and any consumer of `GET /api/agents/:slug`) could not surface capability or relationship data without parsing markdown.

This decision was gated before Sprint 10 because capability data is a precondition for:
- Dashboard AgentRegistryView capability display (Sprint 10 FE)
- Cross-agent delegation validation (Sprint 11 scope)
- Future "find agents by skill" query surface

---

## Decision

All three fields — `skills[]`, `owns[]`, `works_with[]` — are added to `squad.manifest.json` as **identity-layer** fields on each agent entry. They are **not** added to the `agents` DB table at this time.

### Why the manifest, not the DB?

| Criterion | Manifest | DB (agents table) |
|-----------|----------|-------------------|
| These are structural/constitutional data (what an agent IS) | ✅ correct home | ❌ agents table is auth-critical; JSONB bloat adds noise |
| Independent queryability needed at v1 (e.g. SELECT agents by skill) | ❌ not required | ✅ would enable this |
| Read overhead | Zero — loaded once at startup (SEC-C5) | Per-request DB round-trip (or application-layer cache required) |
| Update mechanism | Server restart (acceptable for constitutional data) | DB write (required for frequent runtime changes) |
| Migration required | No | Yes (migration 009 or later) |

**Ruling (Silas):** Skills, owns, and works_with are identity-layer fields — they describe agent capability and structural authority, not runtime state. The `agents` table is auth-critical; adding JSONB columns for structural metadata is a smell. The manifest is the correct home for data that changes on the same cadence as agent role definitions (i.e., rarely, and deliberately).

**Murphy addendum:** When Sprint 12 or later requires skills to be independently queryable (e.g., "show all agents who have the `db-design` skill"), the correct action is to file a migration adding `skills JSONB NOT NULL DEFAULT '[]'` to the `agents` table with a GIN index, and write a sync script to populate it from the manifest. That migration path is explicitly deferred, not foreclosed.

---

## Schema

`squad.manifest.json` bumped from `version: "1.0.0"` to `version: "1.1.0"`.

Each agent entry gains three new fields:

```json
{
  "slug": "murphy",
  "name": "Murphy",
  "role": "Senior Backend Developer",
  "skills": ["api-design", "db-design", "code-review", "bug-triage", "tech-debt-audit"],
  "owns":   ["feature-delivery", "api-contracts", "test-coverage", "developer-mentorship"],
  "works_with": ["silas", "rocket", "scout"]
}
```

**`skills[]`** — Slugs matching the IO Labs skill-library filenames in `~/.copilot/skills/`. An agent should only list skills it is authorised to load and execute. Empty array is valid (e.g., Meridian at v1.1.0 pending skills classification).

**`owns[]`** — Free-form domain strings. These represent the agent's accountability scope as defined in its `IDENTITY.md`. No foreign key; purely descriptive. Format: kebab-case, singular domain noun.

**`works_with[]`** — Agent slugs. Must reference slugs that exist in the manifest. Represents routine collaboration, not exhaustive contact surface. Bidirectional relationships need not be mirrored (Nova lists Zero; Zero is not in the manifest — this is acceptable).

---

## TypeScript Impact

`src/squad-api/manifest.ts` — `ManifestAgent` interface extended:

```typescript
interface ManifestAgent {
  slug: string
  name: string
  role: string
  skills: string[]
  owns: string[]
  works_with: string[]
}
```

The `getManifestAgent(slug)` return type is unchanged — callers receive the full `ManifestAgent | null`.

---

## API Impact

`GET /api/agents/:slug` response — `manifest` object extended:

```json
{
  "agent": {
    "slug": "murphy",
    "display_name": "Murphy",
    "active": true,
    "active_task_count": 2,
    "manifest": {
      "role": "Senior Backend Developer",
      "skills": ["api-design", "db-design", "code-review", "bug-triage", "tech-debt-audit"],
      "owns": ["feature-delivery", "api-contracts", "test-coverage", "developer-mentorship"],
      "works_with": ["silas", "rocket", "scout"]
    }
  }
}
```

`GET /api/agents` (list) — unchanged. List endpoint returns `AgentRow` without manifest data. If consumers need skills on the list view, the dashboard can join manifest data client-side from the detail endpoint, or a future `/api/agents?include=manifest` parameter can be added.

`docs/openapi.yaml` — `AgentManifest` schema updated to include `skills`, `owns`, `works_with` as required string arrays.

---

## Test Coverage

**TC-SA11b** (new) — Seeds `murphy` into the test DB, GETs `/api/agents/murphy`, asserts:
- `manifest` is not null
- `manifest.role === "Senior Backend Developer"`
- `manifest.skills` is an array containing `"api-design"`
- `manifest.owns` is an array containing `"feature-delivery"`
- `manifest.works_with` is an array containing `"silas"`

**TC-SA11** (unchanged) — `squad-test-agent` is not in the manifest; `manifest === null` still holds.

---

## Migration Path (Deferred)

If Sprint 12 or later requires:

1. `SELECT * FROM agents WHERE skills @> '["db-design"]'` queries
2. Skills to be writable without a server restart
3. Cross-table joins between skills and tasks/thoughts

Then file migration `009_agent_capability_columns.sql`:

```sql
ALTER TABLE agents
  ADD COLUMN skills       JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN owns         JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN works_with   JSONB NOT NULL DEFAULT '[]';

CREATE INDEX idx_agents_skills ON agents USING GIN(skills);
```

And write a sync script that reads `squad.manifest.json` and populates these columns on startup or via `npm run sync:manifest`. The manifest remains the source of truth; the DB columns become a queryable replica.

---

## Consequences

- **Positive:** Zero migration cost. No DB schema change. Zero query overhead. Skills, owns, and works_with are now surfaced on `GET /api/agents/:slug` and documented in OpenAPI.
- **Positive:** Pre-Sprint 10 gate is cleared. Dashboard can display agent capability maps.
- **Negative:** Skills are not queryable across agents without loading all manifests. Acceptable at v1.
- **Negative:** `works_with` references are not FK-validated. A typo in a slug will not be caught at runtime. Mitigated: manifest is small, human-reviewed at deploy time.
- **Deferred cost:** Sprint 12+ migration if queryable skills become a product requirement.
