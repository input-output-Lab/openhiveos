---
title: "ARCH-021 — Portfolio Matrix: Value Domain, ROI Computation, Chart Library, and Type Contracts"
date: 2026-06-11
status: Decided
decision_owner: Silas
approved_by: Elizabeth
filed_by: Silas
tags:
  - type/adr
  - project/openhiveos
  - domain/architecture
  - domain/backend
  - domain/frontend
related:
  - "[[ARCH-019-sprint-9-api-surface]]"
  - "[[ARCH-020-manifest-agent-capability-extension]]"
---

# ARCH-021 — Portfolio Matrix: Value Domain, ROI Computation, Chart Library, and Type Contracts

**Status:** Decided  
**Date:** 2026-06-11  
**Decision Owner:** Silas  
**Approved By:** Elizabeth (sprint planning session)  
**Founder Confirmation:** Richo (value domain + auth model, 2026-06-11)  

---

## Context

Sprint 11 introduces portfolio matrix scoring and visualisation across all projects. Four decisions required architectural rulings before implementation could begin. This ADR consolidates all four, plus a corrective schema finding identified during pre-sprint analysis.

---

## Decision 1 — Value Domain: 1/3/5 Categorical

**Ruling:** The fields `business_value`, `strategic_fit`, `effort`, and `risk_index` accept only the categorical values **1, 3, or 5**. `null` is permitted and means "not yet scored."

**Authority:** Richo (Founder), confirmed 2026-06-11 during Sprint 11 planning.

**Rationale:** Consistent with the IO Labs ROI Scoring SOP (Business Value × Strategic Fit ÷ Effort). Categorical constraints force meaningful differentiation — arbitrary 1–10 scales produce false precision and inconsistent scoring across agents.

**Enforcement:**
- **Database:** `CHECK (field IN (1, 3, 5))` on all four columns (see schema finding below)
- **MCP tool:** Zod schema `z.union([z.literal(1), z.literal(3), z.literal(5)]).nullable().optional()`
- **REST endpoint:** Same Zod schema applied server-side on the PATCH handler
- **TypeScript:** Narrowed types `1 | 3 | 5 | null` on all four fields in `src/types.ts`

**Alternatives ruled out:**
- 1–10 numeric: rejected — produces false precision, inconsistent cross-agent scoring
- 1–5 ordinal: rejected — includes values (2, 4) with no defined semantic meaning in the scoring SOP

---

## Decision 2 — ROI Score: Computed on Read, Never Stored

**Ruling:** `roi_score` is computed at query time as `business_value × strategic_fit ÷ effort`. It is never written to the database.

**Formula:** `roi_score = business_value × strategic_fit ÷ effort`

**Null conditions:** `roi_score = null` when any of the following are true:
- `business_value IS NULL`
- `strategic_fit IS NULL`
- `effort IS NULL`
- `effort = 0` (division guard — should not occur given 1/3/5 constraint, but handled defensively)

**Implementation:** Computed in the squad-api route handler, added to the response shape. Never persisted. `roi_score` column does not exist in the database.

**TypeScript type:** `roi_score?: number | null` (optional on the Project type — absent if not computable)

**Rationale:** Storing a derived value creates a synchronisation problem — any update to any component field requires recomputing and rewriting the score. Computing on read eliminates stale data, reduces write complexity, and keeps the schema minimal.

**Alternatives ruled out:**
- Store computed score: rejected — stale value risk on any component update; adds write complexity to every PATCH handler

---

## Decision 3 — Chart Library: Chart.js + vue-chartjs

**Ruling:** The portfolio bubble chart (S11-FE-02) uses **Chart.js** with the **vue-chartjs** Vue 3 wrapper.

**Bundle impact:** ~60KB gzip. Current dashboard bundle: 59.2KB gzip. Combined total: ~119KB gzip. Budget ceiling: 400KB. **Within budget.**

**Rationale:**
- Bubble chart is a built-in Chart.js chart type — zero custom rendering required
- vue-chartjs provides a reactive Vue 3 component wrapper with full TypeScript support
- Lightest option that provides native bubble chart support
- Accessibility: Chart.js renders to `<canvas>` — data table fallback required for screen readers (see S11-FE-02 acceptance criteria)

**Alternatives ruled out:**
- Apache ECharts + vue-echarts: more powerful, ~180KB gzip — excessive for a single chart type
- Pure SVG (no library): 0KB — 2× development time; manual hit detection, tooltips, and responsiveness; not justified

**Constraint:** Rocket installs vue-chartjs only after this ADR is filed. Library install is not a pre-sprint discretionary choice.

---

## Decision 4 — Auth Model: Tool-Assignment Gate

**Ruling:** The `update_project` MCP tool and `PATCH /api/projects/:id` REST endpoint enforce **no ownership restriction**. Any authenticated agent may update portfolio matrix fields.

**Authority:** Richo (Founder), confirmed 2026-06-11.

**Rationale:** Tool-assignment in `squad.manifest.json` is the access gate. If an agent does not have `update_project` in their `owns[]` array, they cannot call the tool. Ownership restriction at the endpoint level is redundant and creates friction for cross-functional scoring workflows (e.g., Elizabeth scoring a project she doesn't own).

**Security controls that replace ownership check:**
1. Valid agent token required (existing auth middleware — unchanged)
2. Explicit field allowlist on PATCH handler — mass assignment impossible
3. Zod schema validation — invalid values rejected before any DB write
4. Parameterised queries — no SQL injection surface
5. Locksmith gate required before either S11-BE-00 or S11-BE-03 merges

**Fields that may NEVER be updated via these endpoints:**
`id`, `slug`, `name`, `description`, `status`, `owner_agent_slug`, `created_at`, `updated_at`

---

## Schema Finding — Corrective Migration Required

**Issue identified during pre-sprint analysis:**

Migration 012 (`012_project_portfolio_matrix.sql`) contains an inconsistent constraint on `risk_index`:

```sql
-- Migration 012 (INCORRECT for risk_index)
ADD COLUMN risk_index INT DEFAULT 1 CHECK (risk_index BETWEEN 1 AND 5);
```

`BETWEEN 1 AND 5` allows values 2 and 4, which are invalid under Decision 1. The other three fields correctly use `IN (1, 3, 5)`.

Additionally, `DEFAULT 1 NOT NULL` makes `risk_index` non-nullable and always-set, inconsistent with the sprint decision that `null = not yet scored` applies to all four fields.

**Corrective migration filed:** `migrations/013_fix_risk_index_constraint.sql`

```sql
-- Corrective actions in migration 013:
-- 1. Drop CHECK (BETWEEN 1 AND 5)
-- 2. Drop DEFAULT 1
-- 3. Make column nullable
-- 4. Add CHECK (IN (1, 3, 5))
```

**Data safety:** All existing `risk_index = 1` rows remain valid. No data is lost or corrupted — 1 is a member of {1, 3, 5}.

**TypeScript fix applied:** `src/types.ts` updated. All four fields narrowed from `number | null` to `1 | 3 | 5 | null`. `risk_index` made nullable. `roi_score` type corrected to `number | null`. Zero TypeScript errors confirmed post-change.

**Cooper:** Apply migration 013 before Murphy begins S11-BE-03 or S11-BE-00.

---

## Implications for Murphy (S11-BE-03, S11-BE-00)

```ts
// Zod schema for all four portfolio matrix fields
const portfolioMatrixSchema = z.object({
  business_value: z.union([z.literal(1), z.literal(3), z.literal(5)]).nullable().optional(),
  strategic_fit:  z.union([z.literal(1), z.literal(3), z.literal(5)]).nullable().optional(),
  effort:         z.union([z.literal(1), z.literal(3), z.literal(5)]).nullable().optional(),
  risk_index:     z.union([z.literal(1), z.literal(3), z.literal(5)]).nullable().optional(),
}).refine(
  (data) => Object.values(data).some((v) => v !== undefined),
  { message: 'At least one field must be provided' }
)

// ROI computation (server-side, read path only)
function computeRoiScore(
  bv: 1 | 3 | 5 | null,
  sf: 1 | 3 | 5 | null,
  effort: 1 | 3 | 5 | null
): number | null {
  if (bv == null || sf == null || effort == null || effort === 0) return null
  return (bv * sf) / effort
}
```

**Shared DB function pattern:** Extract `applyPortfolioUpdate(projectId, fields)` to `src/db/queries/projects.ts`. Both `src/utilities/update-project.ts` (MCP tool) and `src/squad-api/routes/projects.ts` (PATCH endpoint) call this shared function. No duplication.

---

## Implications for Rocket (S11-FE-01, S11-FE-02, S11-FE-03)

- Install: `npm install chart.js vue-chartjs` in `packages/dashboard/`
- Bubble chart axes: X = `strategic_fit`, Y = `business_value`, size = `roi_score`, colour = `risk_index`
- Colour encoding for `risk_index`: `#71F79F` (1 = low), `#F59E0B` (3 = medium), `#EF4444` (5 = high) — colour is never the sole indicator (label + size also encode information, satisfying WCAG AA)
- Data table fallback required below the canvas element for screen reader users
- `roi_score` null → display `—` (not 0, not NaN, not blank)
- Edit form: segmented control (not a text input) — three buttons per field labelled with both value and meaning

| Field | 1 label | 3 label | 5 label |
|---|---|---|---|
| business_value | Low | Medium | High |
| strategic_fit | Low Fit | Aligned | Core |
| effort | Low | Medium | High |
| risk_index | Low | Medium | High |

---

## Revisit Conditions

- If the 1/3/5 scoring model proves too coarse after operator feedback → Richo decision to expand domain. Schema constraint, Zod validator, and TypeScript types all change together. Migration required.
- If bundle budget drops below 200KB → evaluate replacing Chart.js with pure SVG rendering.
- If `roi_score` needs to be filterable server-side → evaluate materialising as a generated column in PostgreSQL.

---

*ARCH-021 authored and filed by Silas. Ruling is binding from date of filing. Cooper must apply migration 013 before Murphy begins S11-BE-03.*
