-- migrations/022_usage_enrichment.sql
-- S17-DB-01 (#2553): enrich llm_usage + models registry with aliases
--
-- Schema design: Silas (design ruling, 2026-10-29) — approve-with-changes.
-- Changes from the draft: cut skills/outcome/tool_call_count/active_seconds/
-- ended_at/reasoning_tokens (no emitter or consumer; derive from
-- tool_invocations once #2543 adds session_id). renamed started_at →
-- requested_at, prompt_categories → prompt_token_details. Added request_id
-- (collector dedupe key — distinct from loop_index, never overload it).
--
-- SEC-C9 stays intact: no pricing columns in this migration. cost_source
-- DEFAULT 'unknown' is the entire #2554 slot. This migration must NOT
-- implement pricing.
--
-- Existing surface preserved:
--   UNIQUE (session_id, loop_index) untouched (SEC-C6).
--   3 views (v_cost_by_agent_month, v_cost_by_project_month, v_cost_by_task)
--   project by name — all ALTERs are additive nullable/defaulted columns.
--
-- Run with:
--   psql "$DATABASE_URL" -f migrations/022_usage_enrichment.sql
-- ---------------------------------------------------------------------------

BEGIN;

-- ---------------------------------------------------------------------------
-- llm_models — canonical model registry
--
-- canonical_slug: raw vendor form, e.g. 'z-ai/glm-5.3-flashx',
--   'anthropic/claude-opus-5.5'. The form normalizeModelId() produces.
-- provider_slug: canonical provider name. Resolves the historical
--   'zai' vs 'z.ai' drift in llm_usage.provider.
-- ---------------------------------------------------------------------------

CREATE TABLE llm_models (
  id              BIGSERIAL PRIMARY KEY,
  canonical_slug  TEXT NOT NULL UNIQUE,
  provider_slug   TEXT NOT NULL,
  display_name    TEXT,
  active          BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT chk_llm_models_provider CHECK (provider_slug <> '')
);

-- alias → model. Many-to-one by design (spike #2544 found 3+ variants per
-- model: 'copilot/claude-opus-5.5', 'openrouter/OpenRouter/claude-opus-5.5',
-- raw 'claude-opus-5.5'). Referential integrity over JSONB convenience.
CREATE TABLE llm_model_aliases (
  alias     TEXT PRIMARY KEY,
  model_id  BIGINT NOT NULL REFERENCES llm_models(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_llm_models_provider ON llm_models (provider_slug);

-- ---------------------------------------------------------------------------
-- llm_usage enrichment — additive, nullable/defaulted (view-safe)
-- ---------------------------------------------------------------------------

ALTER TABLE llm_usage
  ADD COLUMN project_id            BIGINT,        -- soft ref: Coordination Utility tier (mirrors task_id)
  ADD COLUMN client_surface        TEXT,
  ADD COLUMN requested_at          TIMESTAMPTZ,   -- per-request event time (collector timestamp); distinct from recorded_at (ingest time)
  ADD COLUMN request_id            TEXT,          -- collector-side dedupe key (e.g. 'request_ee009a7e-…'); NOT loop_index
  ADD COLUMN reasoning_tokens      INTEGER,
  ADD COLUMN prompt_token_details  JSONB,         -- raw promptTokenDetails blob: [{label, percentageOfPrompt}]
  ADD COLUMN cost_source           TEXT NOT NULL DEFAULT 'unknown',
  ADD COLUMN model_id              BIGINT REFERENCES llm_models(id);

ALTER TABLE llm_usage
  ADD CONSTRAINT chk_llm_usage_reasoning CHECK (reasoning_tokens IS NULL OR reasoning_tokens >= 0),
  ADD CONSTRAINT chk_llm_usage_client_surface CHECK (client_surface IS NULL OR client_surface IN
    ('vscode-copilot', 'claude-code', 'bridge', 'cli', 'cron', 'api')),
  ADD CONSTRAINT chk_llm_usage_cost_source CHECK (cost_source IN ('reported', 'estimated', 'unknown'));

CREATE INDEX idx_llm_usage_model_recorded   ON llm_usage (model_id, recorded_at)   WHERE model_id IS NOT NULL;
CREATE INDEX idx_llm_usage_project_recorded ON llm_usage (project_id, recorded_at) WHERE project_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Seed registry — models observed in production (spike #2544 + live data).
-- canonical_slug uses the raw vendor form. Every observed alias form is
-- seeded EXPLICITLY — including both OpenRouter forms (normalizeModelId is
-- lossy for 'openrouter/OpenRouter/…': alias both to the raw canonical).
-- ---------------------------------------------------------------------------

INSERT INTO llm_models (canonical_slug, provider_slug, display_name) VALUES
  ('z-ai/glm-5.3-flashx',        'z-ai',            'GLM 5.3 FlashX'),
  ('z-ai/glm-5.3-flash',         'z-ai',            'GLM 5.3 Flash'),
  ('z-ai/glm-4.7',               'z-ai',            'GLM 4.7'),
  ('z-ai/glm-4.6',               'z-ai',            'GLM 4.6'),
  ('anthropic/claude-opus-5.5',  'anthropic',       'Claude Opus 5.5'),
  ('anthropic/claude-sonnet-4-5','anthropic',       'Claude Sonnet 4.5'),
  ('anthropic/claude-haiku-4.5', 'anthropic',       'Claude Haiku 4.5'),
  ('anthropic/claude-haiku-5.5', 'anthropic',       'Claude Haiku 5.5'),
  ('anthropic/claude-sonnet-4.6','anthropic',       'Claude Sonnet 4.6')
ON CONFLICT (canonical_slug) DO NOTHING;

INSERT INTO llm_model_aliases (alias, model_id)
SELECT a.alias, m.id
FROM (VALUES
  -- GLM family
  ('zai/glm-5.3-flashx',                          'z-ai/glm-5.3-flashx'),
  ('openrouter/z-ai/glm-5.3-flashx',              'z-ai/glm-5.3-flashx'),
  ('openrouter/OpenRouter/z-ai/glm-5.3-flashx',   'z-ai/glm-5.3-flashx'),
  ('copilot/z-ai/glm-5.3-flashx',                 'z-ai/glm-5.3-flashx'),
  ('zai/glm-5.3-flash',                           'z-ai/glm-5.3-flash'),
  ('openrouter/OpenRouter/z-ai/glm-5.3-flash',    'z-ai/glm-5.3-flash'),
  ('zai/glm-4.7',                                 'z-ai/glm-4.7'),
  ('zai/glm-4.6',                                 'z-ai/glm-4.6'),
  -- Claude family
  ('copilot/claude-opus-5.5',                     'anthropic/claude-opus-5.5'),
  ('openrouter/OpenRouter/anthropic/claude-opus-5.5', 'anthropic/claude-opus-5.5'),
  ('openrouter/anthropic/claude-opus-5.5',        'anthropic/claude-opus-5.5'),
  ('claude-opus-5.5',                             'anthropic/claude-opus-5.5'),
  ('copilot/claude-sonnet-4-5',                   'anthropic/claude-sonnet-4-5'),
  ('claude-sonnet-4-5',                           'anthropic/claude-sonnet-4-5'),
  ('copilot/claude-haiku-4.5',                    'anthropic/claude-haiku-4.5'),
  ('claude-haiku-4.5',                            'anthropic/claude-haiku-4.5'),
  ('copilot/claude-haiku-5.5',                    'anthropic/claude-haiku-5.5'),
  ('claude-haiku-5.5',                            'anthropic/claude-haiku-5.5'),
  ('copilotcli/claude-sonnet-4.6',                'anthropic/claude-sonnet-4.6'),
  ('claude-sonnet-4.6',                           'anthropic/claude-sonnet-4.6'),
  -- legacy self-report era names (dash form / bare model), found in live backfill
  ('zai-glm-5.3-flashx',                          'z-ai/glm-5.3-flashx'),
  ('zai-glm-5.3-flash',                           'z-ai/glm-5.3-flash'),
  ('zai-glm-4.7',                                 'z-ai/glm-4.7'),
  ('zai-glm-4.6',                                 'z-ai/glm-4.6'),
  ('glm-5.3-flash',                               'z-ai/glm-5.3-flash')
) AS a(alias, canonical_slug)
JOIN llm_models m ON m.canonical_slug = a.canonical_slug
ON CONFLICT (alias) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Enriched view — joins the registry; existing views untouched
-- ---------------------------------------------------------------------------

CREATE VIEW v_usage_enriched AS
SELECT
  u.id,
  u.session_id,
  u.loop_index,
  u.agent_slug,
  u.task_id,
  u.project_id,
  u.client_surface,
  u.model,
  u.provider,
  COALESCE(m.canonical_slug, u.model)  AS canonical_model,
  COALESCE(m.provider_slug, u.provider) AS canonical_provider,
  u.model_id,
  u.prompt_tokens,
  u.completion_tokens,
  u.reasoning_tokens,
  u.cache_read_tokens,
  u.cache_creation_tokens,
  u.prompt_token_details,
  u.cost_usd,
  u.cost_source,
  u.requested_at,
  u.recorded_at
FROM llm_usage u
LEFT JOIN llm_model_aliases al ON al.alias = u.model
LEFT JOIN llm_models m ON m.id = al.model_id;

-- ---------------------------------------------------------------------------
-- Backfill — single transaction, idempotent guards (pattern scales past 62 rows)
-- Order: ① seed (done above) ② alias-resolve model_id ③ orphan report
-- ④ provider normalisation.
-- ---------------------------------------------------------------------------

-- ② resolve model_id from existing llm_usage.model via the alias table
UPDATE llm_usage u
SET    model_id = al.model_id
FROM   llm_model_aliases al
WHERE  al.alias = u.model
  AND  u.model_id IS NULL;

-- ③ orphans: model not in the registry — reported, not failed.
--    Operator decision per orphan: add alias, or leave model_id NULL.
DO $$
DECLARE
  orphan_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO orphan_count FROM llm_usage WHERE model_id IS NULL AND model IS NOT NULL;
  IF orphan_count > 0 THEN
    RAISE NOTICE 'backfill: % llm_usage rows have no alias match (model_id left NULL)', orphan_count;
  END IF;
END $$;

-- ④ provider normalisation: historical drift 'zai' / 'z.ai' → 'z-ai'
UPDATE llm_usage SET provider = 'z-ai' WHERE provider IN ('zai', 'z.ai');

-- ---------------------------------------------------------------------------
-- Grants — reader role gets the registry + enriched view
-- ---------------------------------------------------------------------------

GRANT SELECT ON llm_models TO openhiveos_reader;
GRANT SELECT ON llm_model_aliases TO openhiveos_reader;
GRANT SELECT ON v_usage_enriched TO openhiveos_reader;

COMMIT;
