-- migrations/002_coordination_utilities.sql
-- OpenHiveOS — Coordination Utilities schema
--
-- Introduces three tables: projects, tasks, sprints.
-- Also activates the deferred FK constraints on memories.task_id and
-- thoughts.task_id that were intentionally left as soft references in 001_init.sql.
--
-- ADR: docs/ARCH-010-coordination-utilities-schema.md (Accepted 2026-05-20)
--
-- Security conditions enforced by this migration:
--   SEC-21: Cross-agent write authorization — owner_agent_slug is FK to agents(slug)
--   SEC-22: Input validation — slug CHECK constraint enforced at DB level
--   SEC-23: advance_sprint idempotency — UNIQUE(project_id, sprint_number)
--   SEC-25: Dynamic filter columns are validated at app layer against named constants
--
-- Execution order is intentional. Do NOT reorder:
--   1. Promote INT → BIGINT on memories and thoughts (must precede FK ADD CONSTRAINT)
--   2. CREATE TABLE projects (FK anchor for tasks and sprints)
--   3. CREATE TABLE tasks (FKs → projects + agents)
--   4. CREATE TABLE sprints (FK → projects)
--   5. Indexes
--   6. Activate deferred FKs on memories.task_id and thoughts.task_id
--      (must come AFTER CREATE TABLE tasks — PostgreSQL validates referenced
--       table exists at ADD CONSTRAINT time, not at transaction BEGIN)
--
-- Run with:
--   psql "$DATABASE_URL" -f migrations/002_coordination_utilities.sql
-- ---------------------------------------------------------------------------

BEGIN;

-- ---------------------------------------------------------------------------
-- Step 1: Promote memories.task_id and thoughts.task_id from INT to BIGINT
--
-- tasks.id is BIGSERIAL (BIGINT). PostgreSQL rejects FK constraints across
-- mismatched integer types. These columns were declared INT in 001_init.sql
-- because the tasks table did not yet exist. Promotion is safe — INT values
-- are implicitly cast; no data loss is possible.
-- ---------------------------------------------------------------------------

ALTER TABLE memories ALTER COLUMN task_id TYPE BIGINT;
ALTER TABLE thoughts ALTER COLUMN task_id TYPE BIGINT;

-- ---------------------------------------------------------------------------
-- projects
--
-- Unit of work that groups tasks and sprints. Every project is owned by a
-- single agent (owner_agent_slug). Ownership is enforced at the application
-- layer on every mutating query — the DB-level FK ensures the slug is valid.
--
-- slug: human-stable identifier for MCP tool params. Enforced unique.
--   Pattern: lowercase alphanumeric + hyphens, no leading/trailing hyphens.
--   Example: "openhiveos", "murphy-auth-refactor"
--
-- status: 'active' | 'archived' — intentionally narrow. Enum expansion
--   requires a new migration (documented as accepted tech debt, Sprint 4).
-- ---------------------------------------------------------------------------

CREATE TABLE projects (
  id               BIGSERIAL   PRIMARY KEY,
  slug             TEXT        NOT NULL UNIQUE,
  name             TEXT        NOT NULL,
  description      TEXT,
  status           TEXT        NOT NULL DEFAULT 'active',
  owner_agent_slug TEXT        NOT NULL REFERENCES agents(slug),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT chk_projects_slug   CHECK (slug ~ '^[a-z0-9][a-z0-9-]*[a-z0-9]$'),
  CONSTRAINT chk_projects_status CHECK (status IN ('active', 'archived'))
);

-- Composite: most project listing queries filter by status and/or owner
CREATE INDEX idx_projects_status_owner ON projects(status, owner_agent_slug);

CREATE TRIGGER projects_set_updated_at
  BEFORE UPDATE ON projects
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- tasks
--
-- Unit of work within a project. Restricted delete on project_id: a project
-- with tasks cannot be deleted without first resolving those tasks. This is
-- intentional — silent cascade would destroy audit history.
--
-- assignee_agent_slug: nullable. A task may be unassigned. SET NULL on
--   agent delete — the task survives, orphaned from its assignee.
--
-- github_pr_url and notes: optional free-form fields. Validated at app layer
--   only (no DB-level URL format check — Locksmith SEC-22 companion guard
--   is a Zod schema in the handler).
--
-- status lifecycle: todo → wip → review → done | rework
--   'rework' can transition back to wip. Transition guards are in the service
--   layer, not enforced here — the CHECK is existence, not adjacency.
-- ---------------------------------------------------------------------------

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

  CONSTRAINT chk_tasks_status CHECK (
    status IN ('todo', 'wip', 'review', 'done', 'rework')
  )
);

-- Primary join path: project board queries
CREATE INDEX idx_tasks_project_id ON tasks(project_id);

-- Board view: filter by project + status (get_project_board aggregation)
CREATE INDEX idx_tasks_project_status ON tasks(project_id, status);

-- Assignee workload queries (partial: excludes unassigned rows)
CREATE INDEX idx_tasks_assignee ON tasks(assignee_agent_slug)
  WHERE assignee_agent_slug IS NOT NULL;

CREATE TRIGGER tasks_set_updated_at
  BEFORE UPDATE ON tasks
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- sprints
--
-- Sprint history for a project. Append-only — no updated_at column.
-- sprint_number is auto-computed at insert time (MAX + 1) in the application
-- layer. The UNIQUE constraint on (project_id, sprint_number) is the race
-- guard: concurrent advance_sprint calls will produce a PG error 23505
-- (unique_violation), which the handler catches and returns as a structured
-- retryable error — not a 500.
--
-- Richo decision 2026-05-20 (Option B): sprint_number is server-computed,
-- not caller-supplied. Callers supply only sprint_goal.
-- Richo decision 2026-05-20 (Option A): sprint goal history is preserved by
-- row; query_sprints tool deferred to Sprint 4.
--
-- CASCADE delete: removing a project removes its sprint history. This is
-- intentional — a project cannot be deleted while it has tasks (RESTRICT on
-- tasks.project_id), so sprint cascade only fires on task-free projects.
-- ---------------------------------------------------------------------------

CREATE TABLE sprints (
  id            BIGSERIAL   PRIMARY KEY,
  project_id    BIGINT      NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  sprint_number INT         NOT NULL,
  sprint_goal   TEXT,
  started_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT uq_sprints_project_sprint UNIQUE (project_id, sprint_number)
);

-- sprint history lookups and next-number computation (MAX query)
CREATE INDEX idx_sprints_project_id ON sprints(project_id);

-- ---------------------------------------------------------------------------
-- Step 3: Activate deferred FK constraints on memories and thoughts
--
-- These were documented in 001_init.sql as "soft references — FK deferred
-- until tasks table exists." The tasks table now exists above.
-- Placed here (after CREATE TABLE tasks) because PostgreSQL validates the
-- referenced table exists at ADD CONSTRAINT time, not at BEGIN time.
-- SET NULL semantics: deleting a task does not orphan the memory or thought,
-- it simply clears the task reference.
-- ---------------------------------------------------------------------------

ALTER TABLE memories
  ADD CONSTRAINT fk_memories_task_id
  FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE SET NULL;

ALTER TABLE thoughts
  ADD CONSTRAINT fk_thoughts_task_id
  FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE SET NULL;

COMMIT;
