-- migrations/025_task_estimates.sql
-- S16-DB-02 (#2542): typed estimate columns + versioned task_estimates
--
-- Founder decision (L10 2026-10-29, D3): estimates live in TYPED COLUMNS on
-- tasks — numeric, constrained — with the full PERT breakdown in a versioned
-- task_estimates table. metadata is an interim store only: update_task
-- replaces metadata wholesale and JSONB cannot enforce numeric bounds.
--
-- The four canonical fields (numeric always, per Founder D2):
--   estimated_hours     — expected (PERT mean)
--   billing_low         — envelope floor  (CHECK: <= estimated_hours)
--   billing_high        — envelope ceiling (CHECK: >= estimated_hours)
--   estimate_confidence — low | medium | high
--
-- task_estimates: versioned; version 1 = baseline; created_at ordering.
-- Rows written by create_task/update_task; hour-estimation skill output
-- becomes structured data instead of markdown.
--
-- Backfill: from tasks.metadata keys of the same names (the interim store).
-- Rows lacking a numeric set are left NULL — no fake data.
--
-- Rollback: migrations/rollback_025_task_estimates.sql
-- ---------------------------------------------------------------------------

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Typed columns on tasks
-- ---------------------------------------------------------------------------

ALTER TABLE tasks
  ADD COLUMN estimated_hours     NUMERIC(6, 1),
  ADD COLUMN billing_low         NUMERIC(6, 1),
  ADD COLUMN billing_high        NUMERIC(6, 1),
  ADD COLUMN estimate_confidence TEXT,
  ADD CONSTRAINT chk_tasks_estimates_bounds
    CHECK (billing_low IS NULL OR billing_high IS NULL OR estimated_hours IS NULL
           OR (billing_low <= estimated_hours AND estimated_hours <= billing_high)),
  ADD CONSTRAINT chk_tasks_estimates_confidence
    CHECK (estimate_confidence IS NULL OR estimate_confidence IN ('low', 'medium', 'high'));

CREATE INDEX idx_tasks_estimated_hours ON tasks (estimated_hours) WHERE estimated_hours IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 2. task_estimates — versioned PERT breakdown
-- ---------------------------------------------------------------------------

CREATE TABLE task_estimates (
  id           BIGSERIAL PRIMARY KEY,
  task_id      BIGINT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  version      INTEGER NOT NULL,
  -- PERT per-category breakdown: [{category, optimistic, likely, pessimistic, expected}]
  categories   JSONB NOT NULL DEFAULT '[]',
  -- applied complexity modifiers: [{name, multiplier, reason}]
  modifiers    JSONB NOT NULL DEFAULT '[]',
  estimated_hours   NUMERIC(6, 1) NOT NULL,
  billing_low       NUMERIC(6, 1),
  billing_high      NUMERIC(6, 1),
  confidence        TEXT,
  estimator         TEXT,                    -- agent slug or 'human:<name>'
  notes             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT uq_task_estimates_version UNIQUE (task_id, version),
  CONSTRAINT chk_task_estimates_hours CHECK (estimated_hours > 0),
  CONSTRAINT chk_task_estimates_confidence
    CHECK (confidence IS NULL OR confidence IN ('low', 'medium', 'high'))
);

CREATE INDEX idx_task_estimates_task ON task_estimates (task_id, version DESC);

-- ---------------------------------------------------------------------------
-- 3. Backfill from metadata (interim store used since the L10 task creation)
-- ---------------------------------------------------------------------------

INSERT INTO task_estimates (task_id, version, categories, modifiers, estimated_hours, billing_low, billing_high, confidence, estimator, notes)
SELECT
  t.id,
  1,
  COALESCE(t.metadata->'categories', '[]'::jsonb),
  COALESCE(t.metadata->'modifiers', '[]'::jsonb),
  (t.metadata->>'estimated_hours')::numeric(6,1),
  (t.metadata->>'billing_low')::numeric(6,1),
  (t.metadata->>'billing_high')::numeric(6,1),
  t.metadata->>'estimate_confidence',
  COALESCE(t.metadata->>'estimator', 'elizabeth'),
  'backfilled from metadata (interim store) by migration 025'
FROM tasks t
WHERE t.metadata ? 'estimated_hours'
  AND t.metadata->>'estimated_hours' ~ '^[0-9]+(\.[0-9]+)?$'
ON CONFLICT (task_id, version) DO NOTHING;

-- mirror the canonical fields onto tasks for backfilled rows
UPDATE tasks t
SET    estimated_hours     = e.estimated_hours,
       billing_low         = e.billing_low,
       billing_high        = e.billing_high,
       estimate_confidence = e.confidence
FROM   task_estimates e
WHERE  e.task_id = t.id
  AND  e.version = 1
  AND  t.estimated_hours IS NULL;

COMMIT;
