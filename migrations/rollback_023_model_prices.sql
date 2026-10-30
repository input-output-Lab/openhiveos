-- Rollback for 023_model_prices.sql
-- Reverts to pre-#2554 semantics alongside the internal.ts code revert:
-- cost_source back to 'unknown' everywhere, price table dropped.
-- Note: cost_usd was made nullable by 023; if reverting fully to SEC-C9 v1,
-- the application must also be reverted (cost optional → required).

BEGIN;

-- SC-4 revert: keep 'reported' classifications? No — rollback returns the
-- schema to 022 state where cost_source exists but defaults 'unknown'.
UPDATE llm_usage SET cost_source = 'unknown' WHERE cost_source = 'reported';

DROP TABLE IF EXISTS llm_model_prices;

COMMIT;
