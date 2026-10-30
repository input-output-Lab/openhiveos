// ---------------------------------------------------------------------------
// Server-side cost estimation — S17-SEC-01 (#2554)
//
// Implements the SEC-C9 revision per Locksmith ruling (thought #1096):
//   - cost_usd optional on ingestion; when absent the server computes an
//     ESTIMATE from the versioned price list (llm_model_prices) and stores
//     cost_source='estimated'.
//   - Caller-supplied cost is stored verbatim with cost_source='reported'.
//     Accepted risk (ruling): a compromised caller with the ingestion token
//     can fabricate cost via the reported path. Accepted because the token
//     is server-held and cost surfaces are internal-only (Founder D4).
//     RE-RATE if a client-facing surface ever exposes LLM cost.
//
// SC-3 overflow degradation: token inflation × price can overflow the
// NUMERIC(12,8) column (~$99.99 cap). MAX_ESTIMATED_COST clamps the
// computation — a runaway estimate degrades to the clamp, never throws.
// A missing price row also degrades: cost 0, cost_source='unknown'.
// ---------------------------------------------------------------------------

import { pool } from '../db/client.js'

/** NUMERIC(12,8) holds < 1000.0; clamp well below to survive rounding. */
export const MAX_ESTIMATED_COST = 99.99999999

export interface CostEstimate {
  costUsd: number
  source: 'reported' | 'estimated' | 'unknown'
}

interface PriceRow {
  input_per_mtok: string
  output_per_mtok: string
}

/**
 * Resolve the canonical model for an observed surface name via
 * llm_model_aliases (migration 022). Falls back to the raw name — the
 * canonical_slug equals the raw vendor form, so raw names resolve directly.
 */
export async function resolveModelId(model: string): Promise<number | null> {
  const res = await pool.query<{ id: number }>(
    `SELECT m.id
       FROM llm_model_aliases al
       JOIN llm_models m ON m.id = al.model_id
      WHERE al.alias = $1
      UNION
      SELECT m.id
       FROM llm_models m
      WHERE m.canonical_slug = $1
      LIMIT 1`,
    [model],
  )
  return res.rows[0]?.id ?? null
}

/** Clamp helper — SC-3. */
function clamp(cost: number): number {
  if (!Number.isFinite(cost) || cost < 0) return 0
  return Math.min(cost, MAX_ESTIMATED_COST)
}

/**
 * Compute the estimated cost for a request from the CURRENT price row
 * (effective_to IS NULL) of the resolved model.
 * Returns null when the model or its price is unknown — callers store
 * cost 0 with cost_source='unknown' (defined degradation, SC-3).
 */
export async function estimateCost(
  model: string,
  promptTokens: number,
  completionTokens: number,
): Promise<CostEstimate> {
  try {
    const modelId = await resolveModelId(model)
    if (modelId === null) return { costUsd: 0, source: 'unknown' }

    const res = await pool.query<PriceRow>(
      `SELECT input_per_mtok, output_per_mtok
         FROM llm_model_prices
        WHERE model_id = $1 AND effective_to IS NULL
        LIMIT 1`,
      [modelId],
    )
    const price = res.rows[0]
    if (!price) return { costUsd: 0, source: 'unknown' }

    const input = Number(price.input_per_mtok)
    const output = Number(price.output_per_mtok)
    const cost = clamp((promptTokens / 1_000_000) * input + (completionTokens / 1_000_000) * output)
    return { costUsd: cost, source: 'estimated' }
  } catch {
    // Price lookup failure must never fail ingestion — degrade to unknown.
    return { costUsd: 0, source: 'unknown' }
  }
}
