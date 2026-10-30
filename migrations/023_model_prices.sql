-- migrations/023_model_prices.sql
-- S17-SEC-01 (#2554): versioned price list + server-side estimated cost
--
-- Tier 3 security ruling: Locksmith 2026-10-29 (thought #1096).
-- SEC-C9 revision (Founder approved reopening):
--   BEFORE: cost_usd NOT NULL, caller-supplied; no server pricing.
--   AFTER:  cost_usd nullable; server computes estimate from this price list
--           when absent and flags cost_source='estimated'.
--
-- Locksmith conditions implemented here:
--   SC-1  Single-current-price guarantee: partial UNIQUE index on
--         (model_id) WHERE effective_to IS NULL — at most one current row
--         per model. Overlap prevention via tstzrange EXCLUDE constraint.
--   SC-2  NO reader/API surface: this table is server-internal. No GRANT to
--         openhiveos_reader, never exposed via any route or MCP tool.
--   SC-3  Overflow degradation: computed cost is CLAMPED to the column range
--         in application code (internal.ts) and flagged cost_source='estimated'
--         regardless; a runaway computation degrades, never 500s.
--   SC-4  Backfill: existing zero-cost rows → cost_source='unknown' (NOT
--         'reported'). Rows with nonzero cost or tokens → 'reported'.
--         Historical cost_usd values are never overwritten.
--
-- SEC-C6 untouched: UNIQUE(session_id, loop_index) unchanged.
-- ---------------------------------------------------------------------------

BEGIN;

CREATE TABLE llm_model_prices (
  id              BIGSERIAL PRIMARY KEY,
  model_id        BIGINT NOT NULL REFERENCES llm_models(id) ON DELETE CASCADE,
  price_version   INTEGER NOT NULL,
  effective_from  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  effective_to    TIMESTAMPTZ,                       -- NULL = current price
  input_per_mtok  NUMERIC(12, 6) NOT NULL CHECK (input_per_mtok >= 0),
  output_per_mtok NUMERIC(12, 6) NOT NULL CHECK (output_per_mtok >= 0),
  currency        TEXT NOT NULL DEFAULT 'USD',
  source          TEXT NOT NULL DEFAULT 'manual',    -- 'manual' | 'openrouter' | 'litellm' (provenance)
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT uq_llm_model_prices_version UNIQUE (model_id, price_version)
);

-- SC-1a: at most one current (effective_to IS NULL) price per model
CREATE UNIQUE INDEX uq_llm_model_prices_current
  ON llm_model_prices (model_id)
  WHERE effective_to IS NULL;

-- SC-1b: no overlapping effective periods per model (supersession integrity).
-- bigint needs btree_gist for the GiST EXCLUDE constraint.
CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE llm_model_prices
  ADD CONSTRAINT exllm_model_prices_no_overlap
  EXCLUDE USING gist (
    model_id WITH =,
    tstzrange(effective_from, effective_to) WITH &&
  );

CREATE INDEX idx_llm_model_prices_model ON llm_model_prices (model_id);

-- ---------------------------------------------------------------------------
-- Seed prices (USD per 1M tokens) — indicative planning prices, manual source.
-- These are BUDGET estimates, not billing rates; update rows (never delete)
-- as vendor prices change: supersede by setting effective_to = NOW() on the
-- current row, then insert the new version. New model with no price row →
-- estimated cost is unavailable → cost_source stays 'unknown' (defined
-- degradation per SC-3; row capture always succeeds).
-- ---------------------------------------------------------------------------

INSERT INTO llm_model_prices (model_id, price_version, input_per_mtok, output_per_mtok, source)
SELECT m.id, 1, p.input_per_mtok, p.output_per_mtok, 'manual'
FROM (VALUES
  ('z-ai/glm-5.3-flashx',         0.30, 1.20),
  ('z-ai/glm-5.3-flash',          0.20, 0.80),
  ('z-ai/glm-4.7',                0.40, 1.60),
  ('z-ai/glm-4.6',                0.40, 1.60),
  ('anthropic/claude-opus-5.5',  15.00, 75.00),
  ('anthropic/claude-sonnet-4-5', 3.00, 15.00),
  ('anthropic/claude-haiku-4.5',  0.80, 4.00),
  ('anthropic/claude-haiku-5.5',  1.00, 5.00),
  ('anthropic/claude-sonnet-4.6', 3.00, 15.00)
) AS p(canonical_slug, input_per_mtok, output_per_mtok)
JOIN llm_models m ON m.canonical_slug = p.canonical_slug
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- SC-4 backfill: classify existing rows (never touch cost_usd values)
-- ---------------------------------------------------------------------------

UPDATE llm_usage
SET    cost_source = 'reported'
WHERE  cost_source = 'unknown'
  AND  (cost_usd > 0 OR prompt_tokens > 0 OR completion_tokens > 0);

-- Rows remaining 'unknown': $0 zero-token legacy self-reports — correct.

-- ---------------------------------------------------------------------------
-- SC-2: no grants. openhiveos_reader must NOT see pricing.
-- ---------------------------------------------------------------------------

COMMIT;
