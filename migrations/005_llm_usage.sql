-- migrations/005_llm_usage.sql
-- ARCH-015: LLM Usage Tracking schema
--
-- Creates the llm_usage table and three analytical views:
--   v_cost_by_agent_month   — monthly cost aggregated by agent
--   v_cost_by_project_month — monthly cost aggregated by project (via task_id join)
--   v_cost_by_task          — lifetime cost attributed to each task
--
-- Security decisions locked in ARCH-015 Locksmith review:
--   SEC-C6: UNIQUE (session_id, loop_index) — replay injection prevention.
--           loop_index is NOT NULL (OQ-2 resolved: optional loop_index would allow
--           multiple NULL rows per session_id, defeating the constraint in PostgreSQL
--           since NULL != NULL in UNIQUE index comparisons).
--   SEC-C9: cost_usd is NOT NULL — cost must be supplied by Bridge.
--           Server-side pricing computation is not supported. The llm_model_pricing
--           table is explicitly NOT included in this migration.
--
-- OQ-1 resolved: migration is 005 (003_squad_api_role + 003_dashboard_agent +
--   004_ethos_seal consumed the 003 and 004 slots as expected).
--
-- Writer role: openhiveos (superuser — INSERT access, no extra GRANT needed).
-- Reader role: openhiveos_reader — explicit GRANT SELECT below for table + views.
--   Note: ALTER DEFAULT PRIVILEGES in 003_squad_api_role.sql grants SELECT on
--   future tables automatically. Explicit grants here are for documentation
--   clarity and to cover the three views (CREATE VIEW is outside the scope of
--   ALTER DEFAULT PRIVILEGES FOR TABLES in some PostgreSQL configurations).
--
-- Run with:
--   psql "$DATABASE_URL" -f migrations/005_llm_usage.sql
-- ---------------------------------------------------------------------------

BEGIN;

-- ---------------------------------------------------------------------------
-- llm_usage
--
-- One row per agent loop. Inserted by POST /internal/usage on the squad-api,
-- authenticated by OPENHIVEOS_INGESTION_TOKEN (separate from agent bearer tokens).
--
-- session_id: Bridge-assigned session identifier. Format enforced by Zod in
--   the ingestion route: ^[a-z][a-z0-9_-]*:[^:]+:\d{13}$ (mirrors opensquad).
-- loop_index: Zero-based counter within a session. NOT NULL — required for
--   the UNIQUE replay guard to function correctly (OQ-2 resolved).
-- agent_slug: Agent identifier. Soft reference to agents(slug) — not FKed
--   to avoid coupling to the OS Primitive tier at the schema level (ARCH-003).
-- task_id: Soft reference to tasks.id. NULL when usage cannot be attributed
--   to a specific task. Required by v_cost_by_task / v_cost_by_project_month.
-- cost_usd: Required (NOT NULL). Bridge supplies the cost from OpenRouter.
--   No server-side pricing computation (SEC-C9 — llm_model_pricing NOT ported).
-- ---------------------------------------------------------------------------

CREATE TABLE llm_usage (
  id                    BIGSERIAL      PRIMARY KEY,
  session_id            TEXT           NOT NULL,
  loop_index            INTEGER        NOT NULL,
  agent_slug            TEXT           NOT NULL,
  model                 TEXT           NOT NULL,
  provider              TEXT           NOT NULL,
  prompt_tokens         INTEGER        NOT NULL DEFAULT 0,
  completion_tokens     INTEGER        NOT NULL DEFAULT 0,
  cost_usd              NUMERIC(12, 8) NOT NULL,
  cache_read_tokens     INTEGER,
  cache_creation_tokens INTEGER,
  task_id               BIGINT,        -- soft reference: tasks are Coordination Utility tier
  recorded_at           TIMESTAMPTZ    NOT NULL DEFAULT NOW(),

  CONSTRAINT chk_llm_usage_prompt_tokens     CHECK (prompt_tokens >= 0),
  CONSTRAINT chk_llm_usage_completion_tokens CHECK (completion_tokens >= 0),
  CONSTRAINT chk_llm_usage_cache_read        CHECK (cache_read_tokens IS NULL OR cache_read_tokens >= 0),
  CONSTRAINT chk_llm_usage_cache_creation    CHECK (cache_creation_tokens IS NULL OR cache_creation_tokens >= 0),
  CONSTRAINT chk_llm_usage_cost_usd          CHECK (cost_usd >= 0),

  -- SEC-C6 (ARCH-015): replay injection prevention.
  -- A Bridge retry with the same (session_id, loop_index) returns 409, not 500.
  -- An attacker who learns a valid session_id + loop_index cannot inject additional
  -- cost data for that slot — the constraint rejects the duplicate insert.
  CONSTRAINT uq_llm_usage_session_loop UNIQUE (session_id, loop_index)
);

-- Primary lookup: all usage records for an agent (v_cost_by_agent_month, agent detail)
CREATE INDEX idx_llm_usage_agent_slug ON llm_usage(agent_slug);

-- Monthly aggregation queries (ORDER BY month DESC, range filtering)
CREATE INDEX idx_llm_usage_recorded_at ON llm_usage(recorded_at DESC);

-- Task attribution: partial index — excludes the majority of rows (task_id IS NULL)
CREATE INDEX idx_llm_usage_task_id ON llm_usage(task_id)
  WHERE task_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- v_cost_by_agent_month
--
-- Monthly token consumption and cost aggregated by agent_slug.
-- Used by: GET /api/usage/agents and GET /api/usage/agents/:name
-- ---------------------------------------------------------------------------

CREATE VIEW v_cost_by_agent_month AS
SELECT
  agent_slug,
  date_trunc('month', recorded_at)  AS month,
  COUNT(DISTINCT session_id)        AS session_count,
  SUM(prompt_tokens)                AS prompt_tokens,
  SUM(completion_tokens)            AS completion_tokens,
  SUM(cost_usd)                     AS cost_usd
FROM llm_usage
GROUP BY agent_slug, date_trunc('month', recorded_at);

-- ---------------------------------------------------------------------------
-- v_cost_by_project_month
--
-- Monthly cost aggregated by project, via task attribution.
-- Rows where task_id IS NULL are excluded — cannot be attributed to a project.
-- Used by: future dashboard project cost view.
-- ---------------------------------------------------------------------------

CREATE VIEW v_cost_by_project_month AS
SELECT
  p.id                               AS project_id,
  p.name                             AS project_name,
  date_trunc('month', u.recorded_at) AS month,
  SUM(u.prompt_tokens)               AS prompt_tokens,
  SUM(u.completion_tokens)           AS completion_tokens,
  SUM(u.cost_usd)                    AS cost_usd
FROM llm_usage  u
JOIN tasks      t ON t.id = u.task_id
JOIN projects   p ON p.id = t.project_id
GROUP BY p.id, p.name, date_trunc('month', u.recorded_at);

-- ---------------------------------------------------------------------------
-- v_cost_by_task
--
-- Lifetime token consumption and cost attributed to each task.
-- Only tasks with at least one llm_usage row appear in this view.
-- Used by: GET /api/usage/tasks/:id
-- ---------------------------------------------------------------------------

CREATE VIEW v_cost_by_task AS
SELECT
  t.id                    AS task_id,
  t.title                 AS task_title,
  p.name                  AS project_name,
  t.assignee_agent_slug   AS assigned_agent,
  COUNT(u.id)             AS request_count,
  SUM(u.prompt_tokens + u.completion_tokens) AS total_tokens,
  SUM(u.cost_usd)         AS cost_usd,
  MIN(u.recorded_at)      AS first_activity,
  MAX(u.recorded_at)      AS last_activity
FROM llm_usage  u
JOIN tasks      t ON t.id = u.task_id
JOIN projects   p ON p.id = t.project_id
GROUP BY t.id, t.title, p.name, t.assignee_agent_slug;

-- ---------------------------------------------------------------------------
-- Grants — openhiveos_reader (squad-api analytics queries via withReaderRole)
-- ---------------------------------------------------------------------------

GRANT SELECT ON llm_usage               TO openhiveos_reader;
GRANT SELECT ON v_cost_by_agent_month   TO openhiveos_reader;
GRANT SELECT ON v_cost_by_project_month TO openhiveos_reader;
GRANT SELECT ON v_cost_by_task          TO openhiveos_reader;

COMMIT;
