---
id: ARCH-010
title: Coordination Utilities — Schema Design and Query Contracts
status: Accepted
authors: [silas, murphy]
date: 2026-05-20
tags: [architecture, database, coordination-utilities, sprint-3]
related: [ARCH-001, ARCH-002, ARCH-003, ARCH-005, ARCH-007, ARCH-009]
---

# ARCH-010 — Coordination Utilities: Schema Design and Query Contracts

**Status:** Accepted
**Date:** 2026-05-20
**Authors:** Silas (schema design, security review), Murphy (query contracts)
**Sprint:** Sprint 3

---

## Context

ARCH-005 established the two-tier module boundary: OS Primitives live in `src/primitives/`, Coordination Utilities live in `src/utilities/`, and ESLint import rules enforce the separation at the code level. Migration `001_init.sql` delivered the Primitive tier's schema: `agents`, `sops`, `memories`, `thoughts`, `dispositions`. It explicitly placed `tasks`, `projects`, and sprint management out of scope with the comment:

> "OUT scope: tasks · projects · crons (Coordination Utility tier — separate migration set)"

It also placed two soft references — `task_id INT NULL` on `memories` and `task_id INT NULL` on `thoughts` — with the note:

> "FK deferred until tasks table exists. Adding a FK to a table that does not yet exist would couple the OS Primitive tier to the Coordination Utility tier at the schema level, violating ARCH-003."

Sprint 3 delivers the Coordination Utility tier: `projects`, `tasks`, and `sprints` tables, the eight corresponding utility handlers, and the deferred FK activation on `memories` and `thoughts`. This ADR is the single source of truth for migration `002_coordination_utilities.sql` and all Sprint 3 utility implementations.

Locksmith (SEC-21 through SEC-25) provided security requirements during the Sprint 3 architecture review. Two behavioral decisions were resolved by Richo (see Decisions 1 and 2 below) and are locked.

---

## Decisions

**Decision 1 — `advance_sprint` sprint number semantics (Richo, 2026-05-20): Option B — auto-computed.**
The `advance_sprint` utility computes `MAX(sprint_number) + 1` for the given `project_id` inside a transaction. The caller does NOT supply a sprint number. The `UNIQUE(project_id, sprint_number)` constraint is the sole race-condition guard: two concurrent callers that both compute the same MAX will both attempt an INSERT — the second will fail the UNIQUE constraint cleanly and surface a retryable error. No application-layer locking is required.

**Decision 2 — Sprint goal history (Richo, 2026-05-20): Option A — table captures, no query utility until Sprint 4.**
The `sprints` table preserves full history by row from day one. No `query_sprints` utility ships in Sprint 3. This is named debt (see Technical Debt item 1). Sprint 4 remediation is planned.

**Decision 3 — `update_task` authorization scope: project ownership check.**
SEC-21 requires a cross-agent write guard. For Sprint 3, `update_task` authorizes the caller by verifying the task's parent project is owned by the calling agent (`owner_agent_slug = $caller`). A per-task assignee permission model is deferred (see Technical Debt item 2).

**Decision 4 — `projects.status` enum: two-value, migration-locked.**
The enum `('active', 'archived')` is deliberately minimal. Adding a new status value requires an `ALTER TABLE`. This is an accepted constraint for Sprint 3 simplicity (see Technical Debt item 3).

---

## Schema

### Convention Notes (from `001_init.sql`, applied consistently)

- Primary keys: `BIGSERIAL PRIMARY KEY` (ARCH-002). The founding tables used `SERIAL`; Sprint 3 tables begin the `BIGSERIAL` convention for the Coordination tier and all future tables.
- Timestamps: `TIMESTAMPTZ NOT NULL DEFAULT NOW()` for `created_at`; `updated_at` driven by the `set_updated_at()` trigger function defined in `001_init.sql`.
- Naming: snake_case throughout, no `factory_` prefix, no table-name prefixes on column names.
- Constraints: named `chk_` prefix for CHECK constraints to aid diagnostics.
- All DDL executes inside a single `BEGIN … COMMIT` block in the migration file.

---

### `projects`

```sql
CREATE TABLE projects (
  id               BIGSERIAL   PRIMARY KEY,
  slug             TEXT        NOT NULL UNIQUE,
  name             TEXT        NOT NULL,
  description      TEXT,
  status           TEXT        NOT NULL DEFAULT 'active',
  owner_agent_slug TEXT        NOT NULL REFERENCES agents(slug),
  business_value   INT         CHECK (business_value IN (1, 3, 5)),
  strategic_fit    INT         CHECK (strategic_fit IN (1, 3, 5)),
  effort           INT         CHECK (effort IN (1, 3, 5)),
  risk_index       INT         DEFAULT 1 CHECK (risk_index BETWEEN 1 AND 5),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- SEC-22: slug character-set enforcement at the DB layer.
  -- Zod validation in the utility handler is a companion guard, not a substitute.
  -- Allowed: lowercase a-z, digits 0-9, hyphens. No leading/trailing hyphens.
  CONSTRAINT chk_projects_slug CHECK (
    slug ~ '^[a-z0-9][a-z0-9-]*[a-z0-9]$'
  ),

  -- Closed enum — adding a new status requires an ALTER TABLE (named debt item 3).
  CONSTRAINT chk_projects_status CHECK (
    status IN ('active', 'archived')
  )
);

CREATE TRIGGER projects_set_updated_at
  BEFORE UPDATE ON projects
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
```

**Constraint notes:**
- `chk_projects_slug` requires at least two characters (the `^[a-z0-9]…[a-z0-9]$` anchor pair). Single-character slugs are rejected. If single-character slugs must be allowed, the regex must be revisited before a live seed is applied — do not silently expand this during implementation.
- `owner_agent_slug` references `agents(slug)`. No `ON DELETE` clause is specified: deleting an agent row that owns projects must be rejected by the FK default (`RESTRICT`). Projects must be re-assigned or archived before an agent is removed.

---

### `tasks`

```sql
CREATE TABLE tasks (
  id                  BIGSERIAL   PRIMARY KEY,
  project_id          BIGINT      NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  title               TEXT        NOT NULL,
  description         TEXT,
  status              TEXT        NOT NULL DEFAULT 'todo',
  assignee_agent_slug TEXT        REFERENCES agents(slug) ON DELETE SET NULL,
  github_pr_url       TEXT,
  notes               TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Closed enum — five task lifecycle states.
  CONSTRAINT chk_tasks_status CHECK (
    status IN ('todo', 'wip', 'review', 'done', 'rework')
  )
);

CREATE TRIGGER tasks_set_updated_at
  BEFORE UPDATE ON tasks
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
```

**Constraint notes:**
- `ON DELETE RESTRICT` on `project_id`: a project cannot be deleted while tasks exist under it. This is intentional — task history must be explicitly cleaned up before a project is removed.
- `assignee_agent_slug` is nullable (unassigned task is a valid state). `ON DELETE SET NULL`: if an agent row is removed, tasks they were assigned to become unassigned rather than orphaned or blocked.
- `github_pr_url` and `notes` are included as non-constrained text fields. Application-layer validation (URL format for `github_pr_url`) is the responsibility of the utility handler.

---

### `sprints`

```sql
CREATE TABLE sprints (
  id            BIGSERIAL   PRIMARY KEY,
  project_id    BIGINT      NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  sprint_number INT         NOT NULL,
  sprint_goal   TEXT,
  started_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- SEC-23: UNIQUE constraint is the sole race-condition guard for advance_sprint.
  -- Two concurrent callers computing MAX + 1 simultaneously will both attempt INSERT;
  -- the second INSERT fails this constraint cleanly. Application layer retries on
  -- unique violation — no advisory locks, no serializable transaction required.
  CONSTRAINT uq_sprints_project_sprint UNIQUE (project_id, sprint_number)
);
```

**Constraint notes:**
- No `updated_at` column and no trigger: sprints are append-only. A sprint row is created by `advance_sprint` and is never mutated. This is by design.
- `ON DELETE CASCADE` on `project_id`: deleting a project removes its sprint history. This is intentional — sprint rows have no meaning without their parent project. Contrast with `tasks`, which uses `RESTRICT` because task data may be referenced externally (e.g., GitHub PR links, agent memories with `task_id`).
- Sprint numbering starts at 1. The `advance_sprint` query is `COALESCE(MAX(sprint_number), 0) + 1` — the first sprint for a new project computes `COALESCE(NULL, 0) + 1 = 1`.

---

### Deferred FK Activation (migration 002 scope)

`001_init.sql` defined `task_id` as `INT` on both `memories` and `thoughts`. Since `tasks.id` is `BIGSERIAL` (8-byte integer), the column types must be promoted to `BIGINT` before a FK constraint can be added. PostgreSQL will reject an FK where the referencing column type does not match the referenced column type.

Migration 002 must execute these four statements (in order) before the FK constraints are added:

```sql
-- Step 1: Promote column types to match tasks.id (BIGINT / BIGSERIAL = 8 bytes).
-- INT in 001_init.sql was a placeholder. No existing rows carry a valid task_id
-- value (tasks table did not exist), so no data conversion risk.

ALTER TABLE memories
  ALTER COLUMN task_id TYPE BIGINT;

ALTER TABLE thoughts
  ALTER COLUMN task_id TYPE BIGINT;

-- Step 2: Activate deferred foreign key constraints.

ALTER TABLE memories
  ADD CONSTRAINT fk_memories_task_id
  FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE SET NULL;

ALTER TABLE thoughts
  ADD CONSTRAINT fk_thoughts_task_id
  FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE SET NULL;
```

**Reasoning for `ON DELETE SET NULL`:**
- A memory or thought that referenced a task retains its content and embedding value even after the task is deleted. Nullifying `task_id` severs the association without destroying the row.
- `ON DELETE CASCADE` would destroy agent memory and thought history on task deletion — an unacceptable data loss pattern for an Agent OS whose value is accumulated context.

**Rollback plan:**
If migration 002 must be rolled back, the FK constraints are dropped first, then the column types are demoted back to `INT`. Demotion is safe only if no `task_id` values exceed `INT4_MAX` (2,147,483,647). At current scale this is not a concern; document the boundary for operational awareness.

```sql
-- Rollback 002 (partial — FK activation reversal only):
ALTER TABLE memories  DROP CONSTRAINT IF EXISTS fk_memories_task_id;
ALTER TABLE thoughts  DROP CONSTRAINT IF EXISTS fk_thoughts_task_id;
ALTER TABLE memories  ALTER COLUMN task_id TYPE INT;
ALTER TABLE thoughts  ALTER COLUMN task_id TYPE INT;
```

---

## Index Strategy

### `projects`

```sql
-- Unique slug lookup (supports: create_project slug conflict check, query_projects slug filter)
-- The UNIQUE constraint implicitly creates this B-tree index; named here for clarity.
-- CREATE UNIQUE INDEX is implied by the UNIQUE constraint on slug — no separate CREATE needed.

-- Filtered project queries (supports: query_projects by status and/or owner)
-- SEC-25 whitelist: this compound index covers the two allowed filter columns.
CREATE INDEX idx_projects_status_owner ON projects(status, owner_agent_slug);

-- Owner-only queries (left-prefix of the compound index covers this; no separate index needed).
-- status-only queries also use idx_projects_status_owner via index scan on first column.
```

### `tasks`

```sql
-- FK scan (supports: all queries that filter by project)
CREATE INDEX idx_tasks_project_id ON tasks(project_id);

-- Primary query pattern (supports: query_tasks by project + status — get_project_board)
-- SEC-25 whitelist: project_id and status are the two highest-cardinality filter columns.
CREATE INDEX idx_tasks_project_status ON tasks(project_id, status);

-- Agent-scoped task queries (supports: query_tasks by assignee_agent_slug)
-- Partial index: excludes unassigned tasks (NULL assignee), which are not addressable
-- by this filter and would otherwise bloat the index.
CREATE INDEX idx_tasks_assignee ON tasks(assignee_agent_slug)
  WHERE assignee_agent_slug IS NOT NULL;
```

### `sprints`

```sql
-- FK scan and advance_sprint MAX() computation
CREATE INDEX idx_sprints_project_id ON sprints(project_id);

-- Note: UNIQUE(project_id, sprint_number) implicitly creates a B-tree index on
-- (project_id, sprint_number). This covers both the uniqueness lookup and the
-- MAX(sprint_number) scan. No separate index is required.
-- The UNIQUE constraint index name will be: uq_sprints_project_sprint (as named above).
```

---

## Query Contracts

All SQL shapes below use positional parameters (`$1`, `$2`, …) matching the TypeScript handler signatures. Full parameterisation is the implementation requirement — no string interpolation of user-supplied values in SQL.

For `query_*` utilities: filter columns must be drawn from an explicit server-side whitelist (SEC-25). Dynamic WHERE clause construction iterates over the whitelist only; unknown filter keys are rejected with a 400 before SQL is constructed.

---

### 1. `create_project`

```sql
INSERT INTO projects (slug, name, description, status, owner_agent_slug)
VALUES ($1, $2, $3, COALESCE($4, 'active'), $5)
RETURNING *;
```

`$1` = slug, `$2` = name, `$3` = description (nullable), `$4` = status (defaults to `'active'` if not supplied), `$5` = `owner_agent_slug` (injected server-side from the bearer token identity — never supplied by the caller payload).

---

### 2. `update_project`

```sql
UPDATE projects
SET    name        = COALESCE($3, name),
       description = COALESCE($4, description),
       status      = COALESCE($5, status)
WHERE  id               = $1
AND    owner_agent_slug = $2
RETURNING *;
```

`$1` = project `id`, `$2` = `owner_agent_slug` injected server-side from bearer identity (SEC-21). If `owner_agent_slug` does not match, the WHERE predicate returns zero rows — the handler treats zero-row result as a 404 (project not found or not owned by caller). Callers cannot distinguish "not found" from "not owned" — this is intentional to avoid enumeration.

---

### 3. `query_projects`

**Allowed filter columns (SEC-25 whitelist):** `status`, `owner_agent_slug`

```sql
SELECT *
FROM   projects
WHERE  [dynamically constructed from whitelist columns only]
ORDER  BY created_at DESC;
```

Dynamic filter construction appends `AND column = $N` for each supplied filter key. Keys not in the whitelist (`['status', 'owner_agent_slug']`) are rejected before query execution.

---

### 4. `get_project_board`

```sql
SELECT
  p.*,
  COUNT(t.id)                                              AS task_count_total,
  COUNT(t.id) FILTER (WHERE t.status = 'todo')             AS task_count_todo,
  COUNT(t.id) FILTER (WHERE t.status = 'wip')              AS task_count_wip,
  COUNT(t.id) FILTER (WHERE t.status = 'review')           AS task_count_review,
  COUNT(t.id) FILTER (WHERE t.status = 'done')             AS task_count_done,
  COUNT(t.id) FILTER (WHERE t.status = 'rework')           AS task_count_rework
FROM   projects p
LEFT JOIN tasks t ON t.project_id = p.id
WHERE  p.id = $1
GROUP BY p.id;
```

SEC-24: `$1` is the project ID. The scope filter (`p.id = $1`) is injected server-side — the handler does not accept a raw WHERE clause from the caller. The LEFT JOIN ensures the project row is returned even when it has zero tasks.

---

### 5. `create_task`

```sql
INSERT INTO tasks (project_id, title, description, status, assignee_agent_slug, github_pr_url, notes)
VALUES ($1, $2, $3, COALESCE($4, 'todo'), $5, $6, $7)
RETURNING *;
```

`$1` = `project_id`, `$2` = `title`, `$3` = `description` (nullable), `$4` = `status` (defaults to `'todo'`), `$5` = `assignee_agent_slug` (nullable), `$6` = `github_pr_url` (nullable), `$7` = `notes` (nullable).

The handler must verify that `project_id` references a project owned by the calling agent before inserting. This is a pre-flight SELECT, not a SQL subquery in the INSERT — keeping the authorization check explicit and auditable.

---

### 6. `update_task`

**Model C — hybrid permission (decided 2026-05-21, Sprint 7):**
- Project **owner**: may update ALL fields on any task in their project.
- **Assignee**: may update the `status` field ONLY on tasks assigned to them, regardless of project ownership.

The handler computes `allowAssigneePath = true` when the request contains `status` and no owner-only fields (title / description / unassign / assignee_agent_slug / github_pr_url / notes). The DB enforces the row gate; the handler enforces the field gate. Both must hold.

```sql
UPDATE tasks
SET    title               = COALESCE($3, title),
       description         = COALESCE($4, description),
       status              = COALESCE($5, status),
       assignee_agent_slug = CASE WHEN $6 THEN NULL ELSE COALESCE($7, assignee_agent_slug) END,
       github_pr_url       = COALESCE($8, github_pr_url),
       notes               = COALESCE($9, notes)
WHERE  id = $1
  AND  (
         project_id IN (SELECT id FROM projects WHERE owner_agent_slug = $2)
         OR ($10 AND assignee_agent_slug = $2)
       )
RETURNING *;
```

`$1` = task `id`, `$2` = `owner_agent_slug` (server-injected, SEC-21), `$6` = `unassign` flag, `$10` = `allowAssigneePath` (handler-computed). Zero-row result surfaces as `not_found_or_unauthorized`. The caller cannot distinguish "not found", "not owned", or "not assigned" — enumeration protection preserved.

Technical Debt item 2 is **closed** as of Sprint 7.

---

### 7. `query_tasks`

**Allowed filter columns (SEC-25 whitelist):** `project_id`, `status`, `assignee_agent_slug`

```sql
SELECT *
FROM   tasks
WHERE  [dynamically constructed from whitelist columns only]
ORDER  BY created_at DESC;
```

Dynamic filter construction appends `AND column = $N` for each supplied filter key. Keys not in the whitelist (`['project_id', 'status', 'assignee_agent_slug']`) are rejected before query execution.

---

### 8. `advance_sprint`

```sql
BEGIN;

INSERT INTO sprints (project_id, sprint_number, sprint_goal, started_at)
VALUES (
  $1,
  (SELECT COALESCE(MAX(sprint_number), 0) + 1 FROM sprints WHERE project_id = $1),
  $2,
  NOW()
)
RETURNING *;

COMMIT;
```

`$1` = `project_id`, `$2` = `sprint_goal` (nullable). The `MAX + 1` subquery and the INSERT execute atomically inside the transaction. If a concurrent caller computes the same `MAX` and both reach the INSERT, the second will fail `uq_sprints_project_sprint`. The handler catches unique-violation errors (PostgreSQL error code `23505`) and surfaces a retryable error to the caller. No advisory locks are required.

---

## Security Notes

### SEC-21 — Cross-agent write authorization

`projects.owner_agent_slug TEXT NOT NULL REFERENCES agents(slug)` is the ownership anchor for the project resource. All mutating utilities (`update_project`, `update_task`, `create_task`) enforce authorization by matching the server-injected caller identity against this column. The `owner_agent_slug` value is never accepted from the caller payload — it is always taken from the bearer token identity resolved by `src/auth/identity.ts`.

`tasks.assignee_agent_slug TEXT REFERENCES agents(slug)` is a nullable attribution column, not an ownership anchor. Under Model C (Sprint 7): an assignee may update the `status` field only on tasks assigned to them. All other fields remain owner-only. See the `update_task` section above.

### SEC-22 — `projects.slug` input validation

The `CHECK` constraint `chk_projects_slug` enforces `^[a-z0-9][a-z0-9-]*[a-z0-9]$` at the database layer. Application-layer Zod validation in the utility handler applies the same regex as a companion guard. Zod fires first and produces a structured error message; the database constraint is the authoritative backstop that survives any code path that bypasses the handler (direct DB access, migration seeds, future adapters).

### SEC-23 — `advance_sprint` idempotency

The `UNIQUE(project_id, sprint_number)` constraint (`uq_sprints_project_sprint`) is the sole concurrency control for `advance_sprint`. The application layer does not require serializable transaction isolation, advisory locks, or distributed locks. The unique constraint failure (PG `23505`) is the signal for the caller to retry. This decision was locked by Richo (Decision 1 above).

### SEC-24 — `get_project_board` scope filter

The `project_id` filter in `get_project_board` is injected server-side as a bound parameter (`WHERE p.id = $1`). The utility handler does not accept a raw filter expression from the caller. The handler must also verify that the requesting agent has read access to the project (i.e., is the owner or is explicitly shared — sharing model is out of scope for Sprint 3 and not implemented). For Sprint 3, `get_project_board` is accessible to the project owner only.

### SEC-25 — Dynamic filter column whitelist

`query_tasks` and `query_projects` construct dynamic WHERE clauses from caller-supplied filter keys. The allowed column names are defined as constants in each utility handler and checked before any SQL is constructed:

- `query_projects` whitelist: `['status', 'owner_agent_slug']`
- `query_tasks` whitelist: `['project_id', 'status', 'assignee_agent_slug']`

Filter keys not in the whitelist are rejected with an HTTP 400 before reaching the database layer. Column name whitelisting at this layer prevents SQL injection via column name substitution — parameterised values alone do not protect against injected column identifiers.

---

## Named Technical Debt

| # | Item | Business Cost | Remediation Cost | Remediation Sprint | Owner |
|---|---|---|---|---|---|
| 1 | **Sprint history query** — `sprints` table captures history by row; no `query_sprints` utility ships in Sprint 3. Agents cannot programmatically retrieve past sprint goals or dates via MCP. | Low: sprint history is available via direct DB inspection; no agent-facing workflow currently depends on it. | 2–3 dev-days: implement `query_sprints` utility handler, register MCP tool, add integration test. | Sprint 4 | Murphy (handler), Silas (query review) |
| 2 | **`update_task` authorization scope** — ~~authorization checks project ownership only~~ **RESOLVED Sprint 7 (2026-05-21).** Model C hybrid permission implemented: project owner may update all fields; assignee may update `status` only. WHERE clause extended with `OR ($allowAssigneePath AND assignee_agent_slug = $callerSlug)`. Handler enforces field gate before DB call. Nova ruling: CLEAR — timing oracle risk NONE (assignments already visible via `query_tasks`). Locksmith soft gate in PR. | — | — | Sprint 7 ✅ | Murphy |
| 3 | **`projects.status` enum is migration-locked** — adding a new project status (e.g., `'paused'`) requires an `ALTER TABLE projects DROP CONSTRAINT chk_projects_status` followed by a new `ADD CONSTRAINT`. The two-value enum (`active`, `archived`) is deliberately minimal for Sprint 3. | Low: no stakeholder has requested additional statuses. Risk is schema churn if product direction shifts. | 1 dev-day: write migration, update Zod schema, update query whitelist if status becomes a filter value. | On-demand | Murphy (migration), Silas (review) |

---

## Alternatives Considered

### A1 — Enum types instead of TEXT + CHECK for status columns

PostgreSQL `ENUM` types (`CREATE TYPE project_status AS ENUM (...)`) were considered for `projects.status` and `tasks.status`. Rejected for two reasons:

1. Adding a value to a PostgreSQL ENUM requires `ALTER TYPE … ADD VALUE`, which is non-transactional in PostgreSQL (cannot be rolled back within a transaction that has already used the type). A CHECK constraint on TEXT is transactional.
2. ENUM types are globally scoped in PostgreSQL — they are shared across tables and migrations. A naming conflict between two enums in a migration batch can be subtle and hard to debug.

TEXT + named CHECK constraint (`chk_*`) is the pattern established in `001_init.sql` (see `chk_thought_type`) and is continued here for consistency.

### A2 — `SERIAL` (INT) primary keys instead of `BIGSERIAL`

`001_init.sql` used `SERIAL PRIMARY KEY` (4-byte INT) for the founding tables. Sprint 3 tables begin the `BIGSERIAL` (8-byte BIGINT) convention. This was considered disruptive to apply retroactively to founding tables — the FK column types on `memories.task_id` and `thoughts.task_id` already required promotion (see Deferred FK Activation above), so the boundary was drawn cleanly: founding tables keep `SERIAL`, Sprint 3+ tables use `BIGSERIAL`.

Rejected alternative: continue `SERIAL` for Sprint 3. Risks: `tasks.id` capped at ~2.1 billion rows. At any realistic agent-task generation rate this is not an imminent concern, but starting at `BIGSERIAL` costs nothing and removes a future migration.

### A3 — `advance_sprint` with caller-supplied sprint number (Option A in Richo review)

Callers supplying the sprint number directly (Option A) was considered. Rejected by Richo (Decision 1). The risk: two callers supplying the same sprint number cannot both succeed — the UNIQUE constraint still fires — but the error is less intuitive for callers who expected their supplied number to be accepted. Auto-computation (Option B) gives callers one less thing to manage and makes the constraint failure a transparent retry signal rather than a "your input was wrong" error.

### A4 — `ON DELETE CASCADE` on `tasks.project_id`

Cascade delete on the project→task FK was considered. Rejected: task rows may be referenced in agent memories (`memories.task_id`) and agent thoughts (`thoughts.task_id`). Silently deleting task rows would orphan those references (since the FK on `memories`/`thoughts` uses `ON DELETE SET NULL`, not cascade). The correct behavior is to force explicit task cleanup before project deletion. `ON DELETE RESTRICT` is the conservative choice — it surfaces the dependency rather than silently deleting associated data.

### A5 — Separate `project_members` table for multi-owner projects

A join table allowing multiple agents to own or contribute to a project was considered. Deferred: Sprint 3 scope is single-owner projects. The ownership model (`owner_agent_slug` on `projects`) is sufficient for the current squad size and use patterns. A `project_members` table would require a new authorization query in every utility handler and a new Locksmith security review. Named as future scope, not as Technical Debt, because the current design does not produce a known business cost at this time.

---

## Consequences

### For Murphy (feature implementation)

- Migration `002_coordination_utilities.sql` must execute the four-step deferred FK activation (column type promotion + FK constraints) before creating the three new tables. Order matters: `projects` → `tasks` → `sprints` (FK dependencies flow in that order).
- All eight utility handlers must inject `owner_agent_slug` from the bearer token identity (`req.agent.slug` or equivalent) — never from the request payload.
- `query_projects` and `query_tasks` handlers must implement the SEC-25 column whitelist before constructing any dynamic WHERE clause. The whitelists are named in the Query Contracts section above and must be constants (not config or user-supplied values).
- `advance_sprint` must catch PostgreSQL error code `23505` (unique_violation) and return a structured retryable error — not a 500.
- `create_task` requires a pre-flight ownership check on `project_id` before the INSERT. Implement as a `SELECT id FROM projects WHERE id = $projectId AND owner_agent_slug = $callerSlug` returning zero rows → 403.

### For Locksmith (security verification)

- SEC-21: Verify that no mutation handler path accepts `owner_agent_slug` from request body or query parameters. The token identity resolver is the sole source.
- SEC-22: Verify the slug CHECK constraint fires correctly for edge cases: single-character slugs, slugs with leading hyphens, slugs with uppercase letters. These should all be rejected.
- SEC-24: Verify that `get_project_board` cannot be called for a project the caller does not own. The Sprint 3 access model is owner-only; confirm the handler enforces this.
- SEC-25: Verify that the filter whitelist check precedes SQL construction and that the error path does not leak schema information in the 400 response.

### For Cooper (infrastructure and operations)

- Migration 002 is a single SQL file (`migrations/002_coordination_utilities.sql`) to be applied with `psql "$DATABASE_URL" -f migrations/002_coordination_utilities.sql`. It is idempotent for the `CREATE TABLE IF NOT EXISTS` statements but not for the `ALTER TABLE` column type promotions — if 002 was partially applied and needs to be re-run, the column type promotions must be guarded with a check or the migration must be rolled back fully first.
- No new PostgreSQL extensions are required — no `vector`, no `pg_cron`, no `uuid-ossp`. The `set_updated_at()` trigger function defined in `001_init.sql` is reused.
- New index count: 6 (three on `tasks`, two on `projects` plus the implicit UNIQUE index, one on `sprints` plus the implicit UNIQUE index). Total DB write overhead is proportional to task and project insert/update rate — at current squad scale, negligible.
- Rollback procedure: documented in the Deferred FK Activation section above. Full rollback of migration 002 requires dropping all new tables (in reverse FK order: `sprints` → `tasks` → `projects`) and reversing the column type promotions on `memories` and `thoughts`.

---

## Revisit Conditions

This ADR should be revisited if any of the following occur:

1. The `projects.status` enum requires a third value — the CHECK constraint pattern must be revisited against a Type-safe enum approach.
2. Multi-agent project ownership becomes a product requirement — the `owner_agent_slug` single-owner model is the primary architectural blocker.
3. `advance_sprint` concurrent call rate exceeds the UNIQUE constraint retry tolerance in production — at that volume, a serializable transaction or advisory lock may be warranted.
4. The Coordination Utilities tier is split into a separate MCP process (ARCH-005 declared target, Sprint 4+) — the query contracts and authorization patterns defined here will need to be reviewed for cross-service boundary implications.
