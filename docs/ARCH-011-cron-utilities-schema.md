---
id: ARCH-011
title: Cron Utilities — Schema Design and Query Contracts
status: Accepted
authors: [silas, locksmith]
date: 2026-05-20
tags: [architecture, database, cron-utilities, sprint-4]
related: [ARCH-005, ARCH-006, ARCH-010]
---

# ARCH-011 — Cron Utilities: Schema Design and Query Contracts

**Status:** Accepted
**Date:** 2026-05-20
**Authors:** Silas (schema design, security requirements), Locksmith (SEC-26 through SEC-30)
**Sprint:** Sprint 4

---

## Context

ARCH-010 delivered the Coordination Utility tier's first three tables (`projects`, `tasks`, `sprints`) and eight tool handlers. The `crons` table was explicitly out of scope in `001_init.sql`, which carries the comment:

> "OUT scope: tasks · projects · crons (Coordination Utility tier — separate migration set)"

Sprint 4 delivers the registration layer for cron scheduling: the `crons` table (migration `003_crons.sql`), four utility handlers (`create_cron`, `update_cron`, `query_crons`, `delete_cron`), and the deferred `query_sprints` handler from ARCH-010 Decision 2.

**Critical scope boundary:** Sprint 4 ships the cron _registration_ layer only. There is no cron _execution_ layer in this sprint. The `tool_name` and `payload` columns record what should be executed, but no worker process reads these values and fires tools. Agents can register, inspect, update, and soft-delete cron entries. Nothing runs until Sprint 5 delivers the cron worker. MCP tool description strings must communicate this clearly to operators.

**Tool name parity with opensquad-mcp-server:** The tool names `create_cron`, `update_cron`, `query_crons`, `delete_cron` are identical to the corresponding tools in opensquad-mcp-server. This is intentional. ARCH-006 establishes the One-OS-Per-Squad deployment model: OpenHiveOS is deployed as a physically isolated instance per Squad. The two servers never share a namespace at runtime. Tool name parity reduces cognitive overhead for operators who work across both systems. Renaming OpenHiveOS tools to avoid the overlap would introduce divergence with no safety benefit.

Locksmith provided SEC-26 through SEC-30 during the Sprint 4 architecture review. Three behavioral decisions were resolved by Richo (see Decisions below) and are locked.

---

## Decisions

**Decision 1 — `delete_cron` semantics (Richo, 2026-05-20): Option A — soft delete.**
`delete_cron` sets `status = 'deleted'` and never executes a physical `DELETE FROM crons`. Hard delete is not acceptable for v0.1: a hard-deleted cron leaves no audit trail, cannot be distinguished from "never existed," and prevents the Sprint 5 worker from detecting mid-run deletions cleanly. The `status IN ('active', 'paused', 'deleted')` CHECK constraint enforces the three valid states at the database layer. Deleted cron rows are excluded from the `idx_crons_active` partial index and from the default `query_crons` result set. This decision is unanimous (Silas, Locksmith, Murphy) and is locked.

**Decision 2 — `query_sprints` authorization scope (Richo, 2026-05-20): Option A — caller-scoped.**
`query_sprints` returns sprint rows only for projects owned by the calling agent (`WHERE p.owner_agent_slug = $callerSlug`). Open-read (any agent querying any project's sprint history) is rejected: it would break the SEC-21 ownership model established in ARCH-010, allow cross-agent enumeration of project sprint history, and set a precedent for unauthenticated read that Locksmith cannot sign off on at v0.1. This decision is locked. If a cross-project sprint view is needed in the future, it must be designed as a separate, explicitly scoped tool with a new Locksmith review.

**Decision 3 — Dockerfile for v0.1.0 release (Richo, 2026-05-20): Option B — defer post-v0.1.**
No Dockerfile is required for the v0.1.0 tag. The S4-07 release packaging task documents this deferral explicitly. A Dockerfile will be created as a standalone chore in Sprint 5 or as a dedicated maintenance item. The v0.1.0 tag cuts on: S4-06 SEC review clean + CI green on main HEAD + Cooper health-green. No docker build gate is included.

---

## Schema

### Convention Notes (continuing from ARCH-010)

- Primary keys: `BIGSERIAL PRIMARY KEY` (ARCH-002). Sprint 3+ tables use BIGSERIAL; founding tables retain SERIAL.
- Timestamps: `TIMESTAMPTZ NOT NULL DEFAULT NOW()` for `created_at`; `updated_at` driven by the `set_updated_at()` trigger function from `001_init.sql`.
- Naming: snake_case throughout, no `factory_` prefix, no table-name column prefixes.
- Constraints: `chk_` prefix for CHECK constraints.
- All DDL executes inside a single `BEGIN … COMMIT` block in the migration file.

---

### `crons`

```sql
CREATE TABLE crons (
  id               BIGSERIAL   PRIMARY KEY,
  project_id       BIGINT      NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  owner_agent_slug TEXT        NOT NULL REFERENCES agents(slug),
  name             TEXT        NOT NULL,
  description      TEXT,
  schedule         TEXT        NOT NULL,
  tool_name        TEXT        NOT NULL,
  payload          JSONB,
  status           TEXT        NOT NULL DEFAULT 'active',
  last_run_at      TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- SEC-26: tool_name is validated at the application layer against REGISTERED_TOOL_NAMES as const.
  -- No DB-level CHECK for tool_name: the whitelist lives in src/utilities/tool-registry.ts
  -- and is bound to the actual registered tools in index.ts. A DB constraint would require
  -- a migration every time a tool is added or renamed — coupling schema to application code.
  -- The application-layer check is the authoritative guard; Locksmith verifies at SEC-26 review.

  -- Soft delete: 'deleted' status replaces physical DELETE (Decision 1).
  CONSTRAINT chk_crons_status CHECK (status IN ('active', 'paused', 'deleted')),

  -- schedule must be a non-empty, non-whitespace-only string.
  -- cron-parser validation at the Zod refine layer (SEC-28) is the format authority.
  -- This constraint is a backstop against empty strings bypassing the application layer.
  CONSTRAINT chk_crons_schedule CHECK (length(trim(schedule)) > 0)
);

CREATE TRIGGER crons_set_updated_at
  BEFORE UPDATE ON crons
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
```

**Constraint notes:**
- `ON DELETE RESTRICT` on `project_id`: a project cannot be deleted while cron registrations exist under it (including soft-deleted ones). This is intentional — cron records are part of the project's audit trail. Cleanup must be explicit.
- `owner_agent_slug` references `agents(slug)` without an `ON DELETE` clause (defaults to `RESTRICT`). An agent cannot be removed while it owns cron registrations.
- `last_run_at` is included in the Sprint 4 schema. It will remain `NULL` for all rows until the Sprint 5 cron worker is delivered — the worker updates this column on each execution. Including it now avoids a Sprint 5 migration. This is an accepted carrying cost (a nullable column that serves no Sprint 4 query).
- `payload` is `JSONB` and nullable. A cron that targets a zero-argument tool will have `payload = NULL`. Non-null payloads are subject to SEC-27 size and nesting controls at the application layer.
- `tool_name` has no DB-level CHECK against a whitelist. The enforcement model is documented in SEC-26 below and in `src/utilities/tool-registry.ts`.

---

## Index Strategy

```sql
-- FK scan (supports all queries filtering by project)
CREATE INDEX idx_crons_project_id ON crons(project_id);

-- Owner-scoped queries (supports: query_crons by owner_agent_slug, SEC-29 ownership gate pre-flight)
CREATE INDEX idx_crons_owner_agent ON crons(owner_agent_slug);

-- Active-cron queries (supports: Sprint 5 worker poll, query_crons default view)
-- Partial index: excludes paused and deleted rows, which are not dispatched and are
-- lower-priority for index locality. This also reduces write amplification on status changes.
CREATE INDEX idx_crons_active ON crons(project_id) WHERE status = 'active';
```

**Index rationale:**
- Three indexes for a table that will grow slowly (cron registration is a low-frequency operation). No compound index on `(project_id, status)` — the partial `idx_crons_active` covers the hot path (active crons per project) at lower storage cost than a full compound index.
- `idx_crons_owner_agent` accelerates the ownership pre-flight SELECT in `delete_cron` and `update_cron` (SEC-29). Without it, every ownership check would full-scan `crons` by agent slug at current schema.

---

## Query Contracts

All SQL shapes below use positional parameters (`$1`, `$2`, …) matching the TypeScript handler signatures. Full parameterisation is required — no string interpolation of user-supplied values in SQL. `owner_agent_slug` values are always injected server-side from the bearer token identity — never accepted from the caller payload.

---

### 1. `create_cron`

```sql
INSERT INTO crons (project_id, owner_agent_slug, name, description, schedule, tool_name, payload, status)
VALUES ($1, $2, $3, $4, $5, $6, $7, COALESCE($8, 'active'))
RETURNING *;
```

`$1` = `project_id`, `$2` = `owner_agent_slug` (injected from bearer token — never from payload), `$3` = `name`, `$4` = `description` (nullable), `$5` = `schedule` (validated by cron-parser at Zod refine before this query runs — SEC-28), `$6` = `tool_name` (validated against `REGISTERED_TOOL_NAMES as const` before this query runs — SEC-26), `$7` = `payload` (nullable JSONB, validated for size and nesting depth at Zod refine — SEC-27), `$8` = `status` (defaults to `'active'`).

The handler must verify that `project_id` references a project owned by the calling agent (pre-flight SELECT) before inserting. This is the same pattern as `create_task` in ARCH-010.

`create_cron` carries the label **SEC-PENDING** until `src/utilities/tool-registry.ts` (SEC-26) is delivered and Locksmith signs off at S4-06.

---

### 2. `update_cron`

```sql
UPDATE crons
SET    name        = COALESCE($3, name),
       description = COALESCE($4, description),
       schedule    = COALESCE($5, schedule),
       tool_name   = COALESCE($6, tool_name),
       payload     = COALESCE($7, payload),
       status      = COALESCE($8, status)
WHERE  id               = $1
AND    owner_agent_slug = $2
AND    status          != 'deleted'
RETURNING *;
```

`$1` = cron `id`, `$2` = `owner_agent_slug` injected server-side from bearer identity (SEC-29). The `status != 'deleted'` predicate prevents updates to soft-deleted crons — a deleted cron cannot be reactivated via `update_cron`. Zero-row result is returned as `{kind: 'not_found_or_unauthorized'}` — callers cannot distinguish not-found from not-owned from deleted (enumeration protection, SEC-29).

`tool_name` and `schedule` updates are subject to the same SEC-26 and SEC-28 validation as `create_cron`.

---

### 3. `query_crons`

**Allowed filter columns (SEC-30 whitelist):** `project_id`, `status`, `owner_agent_slug`

```sql
SELECT *
FROM   crons
WHERE  [dynamically constructed from whitelist columns only]
ORDER  BY created_at DESC;
```

Dynamic filter construction appends `AND column = $N` for each supplied filter key. Keys not in `ALLOWED_CRON_FILTERS as const` (`['project_id', 'status', 'owner_agent_slug']`) are rejected before query execution. Deleted crons (`status = 'deleted'`) are included in results when explicitly filtered by `status = 'deleted'`; the default query (no status filter) does not exclude them — callers who want active-only must supply `status: 'active'`. This is a deliberate audit trail choice.

Cross-agent enumeration note: `query_crons` does not enforce caller-scoped filtering at the query layer for Sprint 4. An agent can query crons across projects they do not own if they know the `project_id`. This is documented as a known trade-off: project IDs are not secret (they appear in `query_projects` results and task data), and the squad deployment model (ARCH-006) means all agents on a Squad share operational visibility. If multi-tenant isolation is required in the future, a caller-scope filter on `owner_agent_slug` must be added to the default query.

---

### 4. `delete_cron` (soft delete)

The `delete_cron` handler performs a pre-flight SELECT before the UPDATE to support auditability and clean discriminated union return values. This mirrors the `create_task` pattern from ARCH-010.

**Pre-flight SELECT:**

```sql
SELECT id, owner_agent_slug, status
FROM   crons
WHERE  id = $1;
```

**Update (if pre-flight returns a row owned by the caller and not already deleted):**

```sql
UPDATE crons
SET    status = 'deleted'
WHERE  id               = $1
AND    owner_agent_slug = $2
RETURNING id;
```

`$1` = cron `id`, `$2` = `owner_agent_slug` injected from bearer token (SEC-29).

**`DeleteCronResult` discriminated union:**

```typescript
type DeleteCronResult =
  | { kind: 'not_found_or_unauthorized' }
  | { kind: 'already_deleted' }
  | { kind: 'success'; id: number };
```

- Pre-flight returns zero rows → `not_found_or_unauthorized`
- Pre-flight row `owner_agent_slug` does not match caller → `not_found_or_unauthorized` (no existence leak)
- Pre-flight row `status === 'deleted'` → `already_deleted`
- UPDATE succeeds → `success` with the cron `id`

Hard DELETE is prohibited. Any code path that executes `DELETE FROM crons` is a SEC-29 violation.

---

### 5. `query_sprints`

**Authorization:** caller-scoped (Decision 2). Returns sprint rows only for projects owned by the calling agent.

**Allowed filter columns:** `project_id`, `sprint_number`

```sql
SELECT s.*
FROM   sprints s
JOIN   projects p ON p.id = s.project_id
WHERE  p.owner_agent_slug = $1
  [AND dynamically constructed filters from whitelist columns only]
ORDER  BY s.project_id ASC, s.sprint_number ASC;
```

`$1` = `owner_agent_slug` injected server-side from bearer token — never from payload. This is the primary authorization predicate and is always present. Optional caller-supplied filters (`project_id`, `sprint_number`) are appended as additional `AND` clauses using the `ALLOWED_SPRINT_FILTERS as const` whitelist.

Filter keys not in `['project_id', 'sprint_number']` are rejected before query execution (SEC-25 pattern).

---

## Security Notes

### SEC-26 — `tool_name` allowlist

`tool_name` in `create_cron` and `update_cron` must be validated against `REGISTERED_TOOL_NAMES as const` — a string union constant defined in `src/utilities/tool-registry.ts`. The constant is derived from the actual tools registered in `index.ts`; they must be kept in sync manually. Murphy proposes the initial list on Day 1 of S4-02; Locksmith validates at S4-06 that the constant matches the index.ts registration exactly.

No `CHECK` constraint at the database layer: the DB-level enum would require a migration for every tool addition or rename, coupling schema evolution to application code changes. The application-layer whitelist is the sole enforcement point. Locksmith's S4-06 sign-off is the verification gate. `create_cron` carries the `SEC-PENDING` label until this gate is cleared.

### SEC-27 — `payload` JSONB controls

`payload` is accepted only as a plain JavaScript object (no arrays, no primitives at the top level). Validation at the Zod refine layer enforces:

- Serialized size ≤ 16 KB
- Maximum nesting depth ≤ 5 levels

The dispatch layer (Sprint 5 worker) must never `...spread` payload directly into a tool call. The worker must validate the payload shape against the tool's registered input schema before dispatch. Sprint 5 must not implement dispatch without this validation.

### SEC-28 — Schedule cron expression validation

`schedule` is validated using `cron-parser` at the Zod refine layer before any DB write. The validation fires in both `create_cron` and `update_cron`. An invalid cron expression produces a structured 400 error; no row is written. The DB `chk_crons_schedule` CHECK constraint (non-empty, non-whitespace) is a backstop only — it does not validate cron syntax.

Cron library selection: Murphy must confirm on Day 1 of S4-02 that the cron-parser library version matches the one used in opensquad-mcp-server (if any) to avoid divergent schedule parsing behaviour across systems.

### SEC-29 — Ownership gate on `update_cron` and `delete_cron`

Both `update_cron` and `delete_cron` enforce ownership via `WHERE owner_agent_slug = $callerSlug` injected from the bearer token. The result of a non-matching lookup is always `not_found_or_unauthorized` — callers cannot distinguish "this cron does not exist" from "this cron exists but is owned by another agent." This pattern prevents enumeration of cron IDs belonging to other agents.

`owner_agent_slug` is set at `create_cron` time and is never mutable. An agent cannot transfer ownership of a cron to another agent via `update_cron` — the `owner_agent_slug` field is excluded from the UPDATE SET clause.

### SEC-30 — `query_crons` filter whitelist

`query_crons` uses `ALLOWED_CRON_FILTERS as const` (`['project_id', 'status', 'owner_agent_slug']`) as the whitelist for dynamic WHERE clause construction. The pattern is identical to SEC-25 from ARCH-010. Keys not in the whitelist are rejected with a 400 before SQL is constructed. The whitelist is a TypeScript constant — not configuration, not user-supplied, not environment-dependent.

---

## Named Technical Debt

| # | Item | Business Cost | Remediation Cost | Remediation Sprint | Owner |
|---|---|---|---|---|---|
| 1 | **Cron execution layer absent** — Sprint 4 ships registration only. `tool_name` and `payload` columns are orphaned; no tool fires. Agents can register schedules but nothing executes them. | High if operators expect active scheduling post-v0.1. Low if communicated clearly (tool description strings must warn). | 5–8 dev-days: scheduler loop, FOR UPDATE SKIP LOCKED double-fire guard, last_run_at update, error handling and dead-letter strategy. | Sprint 5 | Murphy (implementation), Silas (design review) |
| 2 | **`query_crons` cross-agent enumeration** — no caller-scope filter on default query; agents can list crons by project_id regardless of project ownership. Accepted trade-off at v0.1 for single-squad deployment. | Low for single-squad; High if multi-tenant isolation is required. | 1 dev-day: add default `AND owner_agent_slug = $callerSlug` predicate; update ALLOWED_CRON_FILTERS and handler. | On-demand | Silas (design), Murphy (implementation) |
| 3 | **`last_run_at` is always NULL until Sprint 5** — the column exists and is returned in all `query_crons` results as NULL. Operators querying sprint 4 crons will see `last_run_at: null` for every row. | Low: expected and documented. | Resolved by Sprint 5 worker delivery — no schema change required. | Sprint 5 | Murphy (worker) |

---

## Alternatives Considered

### A1 — Hard delete for `delete_cron`

Physical `DELETE FROM crons` was considered. Rejected unanimously (Silas, Locksmith, Murphy) and declared not acceptable for v0.1 by Locksmith. Reasons: no audit trail after deletion; Sprint 5 worker cannot detect a mid-run deletion (a worker that reads a cron ID and then the row disappears has no signal); enumeration gaps in cron IDs are invisible to operators. Soft delete (`status = 'deleted'`) is the only approved pattern.

### A2 — DB-level `tool_name` CHECK constraint against a hardcoded whitelist

A `CONSTRAINT chk_crons_tool_name CHECK (tool_name IN ('create_project', 'update_project', …))` was considered. Rejected: any tool addition or rename requires a migration. The application-layer `REGISTERED_TOOL_NAMES as const` approach is more maintainable and equally safe given the Locksmith SEC-26 gate. The risk of the constant drifting from index.ts is mitigated by the mandatory S4-06 review.

### A3 — Open-read `query_sprints` (Decision 2, Option B)

Allowing any agent to query any project's sprint history was considered. Rejected: breaks the SEC-21 ownership model, enables cross-agent project enumeration via sprint history, and sets a read-without-auth precedent that Locksmith cannot accept at v0.1. Caller-scoped (Option A) is locked.

### A4 — Omit `last_run_at` from Sprint 4 schema

Deferring `last_run_at` to Sprint 5 (where the worker actually uses it) was considered. Rejected by Silas: adding a column in Sprint 5 is a migration cost. Including it now as a nullable column costs one `TIMESTAMPTZ` of storage per row and produces a documented NULL for Sprint 4 consumers. The cost of deferral (Sprint 5 migration + test fixture updates + CI migration validation updates) exceeds the cost of carrying a nullable column for one sprint.

### A5 — Separate `cron_runs` table for execution history

A separate table tracking each cron execution (start time, end time, result, error) was considered for Sprint 5 planning. Deferred: `last_run_at` on the `crons` table is sufficient for Sprint 5's MVP worker. A `cron_runs` history table is named future scope and should be its own ADR when the execution layer design begins.

---

## Consequences

### For Murphy (feature implementation)

- Migration `003_crons.sql` is a single SQL file. It must execute inside a `BEGIN … COMMIT` block. No deferred FK activations are required (Sprint 4 introduces no new `task_id`-style soft references). The file creates the `crons` table, trigger, and three indexes.
- Tool implementation order for S4-02: `query_crons` → `update_cron` → `delete_cron` → `create_cron` (last, because `create_cron` carries the `SEC-PENDING` label until `tool-registry.ts` is delivered). The registry must be delivered by Day 8 EOD for Locksmith to open S4-06 on Day 9.
- `src/utilities/tool-registry.ts` must export `REGISTERED_TOOL_NAMES as const`. Murphy proposes the initial list on Day 1 of S4-02. The list must exactly match the tools registered in `index.ts` — no extras, no omissions.
- `src/db/fingerprint.ts` must be updated to add `'crons'` to `COORDINATION_TABLES`. Boot-time guard must verify the crons table exists before the MCP server accepts connections.
- MCP tool description strings for all four cron tools must include a clear note that the execution layer (Sprint 5 worker) is not present in v0.1 — registering a cron does not cause it to fire.

### For Locksmith (security verification — S4-06)

- SEC-26: Inspect `src/utilities/tool-registry.ts` — confirm `REGISTERED_TOOL_NAMES as const` matches `index.ts` registrations exactly. Confirm `create_cron` and `update_cron` both validate `tool_name` against this constant before any DB write. Confirm a `tool_name` value not in the constant produces a 400 (not a 500, not a DB error).
- SEC-27: Confirm `payload` validation rejects: top-level arrays, top-level primitives, objects > 16 KB serialized, objects nested > 5 levels deep. Confirm the Sprint 5 worker placeholder in the codebase does not contain a `...spread` of payload.
- SEC-28: Confirm `cron-parser` is called at Zod refine for both `create_cron` and `update_cron`. Confirm an invalid expression (e.g., `'not a cron'`) produces a structured 400 and no DB write.
- SEC-29: Confirm `owner_agent_slug` is sourced exclusively from the bearer token in all four cron utility handlers. Confirm `update_cron` does not expose `owner_agent_slug` as a mutable field. Confirm both not-found and not-owned paths return `{kind: 'not_found_or_unauthorized'}` for `update_cron` and `delete_cron`.
- SEC-30: Confirm `ALLOWED_CRON_FILTERS as const` is a TypeScript constant (not config). Confirm filter keys outside the whitelist produce a 400 before query execution. Confirm the 400 response does not leak column names from the schema.
- Hard gate: v0.1.0 tag does not cut with any open blocking finding from S4-06.

### For Cooper (infrastructure and operations)

- Migration 003 is applied to the dev DB after S4-01 merges (S4-04). The apply command follows the PG* env var pattern from `.github/workflows/ci.yml` — no `DATABASE_URL` (gitleaks protection).
- CI update (S4-05): add apply step for `migrations/003_crons.sql` to the `migration-validation` job, expand table verification array to include `'crons'`, add FK verification for `fk_crons_project_id` and the agent slug FK. Structural draft can start Day 0 with table names stubbed; finalize after S4-01 confirms the FK constraint names.
- `GET /health` must be extended (S4-04) to verify the `crons` table is present in the schema (pg_tables check or fingerprint pattern from `src/db/fingerprint.ts`). Returns `{status: 'degraded'}` if the table is missing — not `{status: 'ok'}` with a partial schema.
- No new PostgreSQL extensions are required. No `pg_cron` — the execution layer is an application-level worker (Sprint 5).
- Rollback procedure for migration 003: `DROP TABLE IF EXISTS crons CASCADE;` (the CASCADE removes the trigger). No other tables are affected — crons has no tables depending on it.
- Dockerfile: deferred post-v0.1 (Decision 3). S4-07 release packaging must document the deferral in its notes. A standalone Dockerfile chore is added to the Sprint 5 or maintenance backlog.

### For Silas (architecture)

- `src/db/fingerprint.ts` `COORDINATION_TABLES` array must be updated to include `'crons'` when S4-01 migration is written. This is a Murphy implementation task but Silas must verify during S4-06 review.
- Sprint 5 ADR for the cron worker (ARCH-012) must be filed before Sprint 5 opens. The `FOR UPDATE SKIP LOCKED` double-fire guard pattern from opensquad-mcp-server should be the starting point.
- The cross-agent enumeration gap in `query_crons` (Technical Debt item 2) is documented as on-demand remediation. It must be surfaced in the tech debt ledger and in the Sprint 5 planning session.

---

## Revisit Conditions

This ADR should be revisited if any of the following occur:

1. The Sprint 5 cron worker design requires schema changes to `crons` (e.g., adding a `cron_runs` history table, a `next_run_at` computed column, or a `locked_until` field for the SKIP LOCKED pattern).
2. A multi-tenant deployment scenario requires caller-scoped filtering on `query_crons` by default.
3. A tool is renamed or removed from `index.ts` — `REGISTERED_TOOL_NAMES as const` must be updated and the SEC-26 conditions re-verified by Locksmith.
4. The payload size or nesting limits in SEC-27 prove insufficient or overly restrictive for real operator workflows.
5. An operator requests cross-project sprint history visibility — `query_sprints` caller-scope filter (Decision 2) must be revisited with a new Locksmith security review.
