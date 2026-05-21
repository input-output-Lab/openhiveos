-- migrations/003_crons.sql
-- OpenHiveOS — Cron Utilities schema
--
-- Introduces the crons table: the registration layer for scheduled tool
-- execution. This migration ships the scheduling contract only.
-- No execution layer exists in Sprint 4 — tool_name and payload are
-- orphaned until the Sprint 5 cron worker is delivered.
--
-- ADR: docs/ARCH-011-cron-utilities-schema.md (Accepted 2026-05-20)
--
-- Security conditions enforced by this migration:
--   SEC-26: tool_name allowlist enforced at application layer (REGISTERED_TOOL_NAMES as const)
--           Not a DB CHECK — the whitelist must match index.ts registrations exactly.
--   SEC-27: payload JSONB — size/nesting controls enforced at application layer (Zod refine)
--   SEC-28: schedule format — cron-parser validation at Zod refine; DB constraint = backstop only
--   SEC-29: ownership gate on update_cron / delete_cron — owner_agent_slug from bearer token
--   SEC-30: ALLOWED_CRON_FILTERS as const — enforced at application layer before SQL
--
-- Execution order:
--   1. CREATE TABLE crons (FKs → projects + agents)
--   2. Trigger (set_updated_at defined in 001_init.sql)
--   3. Indexes (project FK scan, owner lookup, active-cron partial index)
--
-- Run with:
--   psql -h $PGHOST -p $PGPORT -U $PGUSER -d $PGDATABASE -f migrations/003_crons.sql
-- ---------------------------------------------------------------------------

BEGIN;

-- ---------------------------------------------------------------------------
-- crons
--
-- Stores cron job registrations: schedule, target tool, and payload.
-- Status lifecycle: active → paused | deleted (soft delete — Decision 1, ARCH-011)
--
-- schedule: cron expression string validated by cron-parser at the application
--   layer (SEC-28). The DB CHECK constraint is a backstop against empty strings
--   only — it does not validate cron syntax.
--
-- tool_name: references a registered MCP tool by name. Validated against
--   REGISTERED_TOOL_NAMES as const in src/utilities/tool-registry.ts (SEC-26).
--   No DB-level CHECK — the whitelist must stay in sync with index.ts registrations,
--   and a DB constraint would require a migration for every tool addition.
--
-- payload: optional JSONB arguments forwarded to the tool on execution.
--   Validated at the application layer for size (≤16KB) and nesting (≤5 levels).
--   NULL is valid for zero-argument tools.
--
-- last_run_at: always NULL until the Sprint 5 cron worker is delivered.
--   Included in Sprint 4 schema to avoid a Sprint 5 migration.
-- ---------------------------------------------------------------------------

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

  -- Soft delete enforced: 'deleted' status replaces physical DELETE (ARCH-011 Decision 1)
  CONSTRAINT chk_crons_status   CHECK (status IN ('active', 'paused', 'deleted')),

  -- Non-empty, non-whitespace schedule. Format authority is cron-parser at Zod refine (SEC-28).
  CONSTRAINT chk_crons_schedule CHECK (length(trim(schedule)) > 0)
);

-- Trigger: keep updated_at current on every UPDATE (set_updated_at defined in 001_init.sql)
CREATE TRIGGER crons_set_updated_at
  BEFORE UPDATE ON crons
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------

-- FK scan: all queries filtering by project
CREATE INDEX idx_crons_project_id ON crons(project_id);

-- Owner lookup: SEC-29 ownership pre-flight SELECT in update_cron / delete_cron
CREATE INDEX idx_crons_owner_agent ON crons(owner_agent_slug);

-- Hot path: Sprint 5 worker polls active crons; query_crons default active view.
-- Partial index excludes paused + deleted rows — reduces write amplification on
-- status changes and improves index locality for the execution hot path.
CREATE INDEX idx_crons_active ON crons(project_id) WHERE status = 'active';

COMMIT;
