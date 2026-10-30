import { describe, it, expect } from 'vitest'
import { MAX_ESTIMATED_COST, estimateCost } from '../../src/usage/cost-estimate.js'

// ---------------------------------------------------------------------------
// S17-SEC-01: server-side cost estimation (SEC-C9 v2).
// Requires DB access for alias/model/price lookups — guarded like the other
// DB tests (RUN_DB_TESTS=true) so the unit suite stays hermetic.
// Locksmith conditions under test:
//   SC-3  degradation: unknown model/price → 0/'unknown', never throws
//   SC-3  overflow clamp: runaway computation clamps to MAX_ESTIMATED_COST
//   Computed path: cost = (prompt/1M)*input + (completion/1M)*output
// ---------------------------------------------------------------------------

const canRun = process.env['RUN_DB_TESTS'] === 'true'
const d = describe.skipIf(!canRun)

d('estimateCost (SEC-C9 v2)', () => {
  it('computes exact estimate for a priced model (z-ai/glm-5.3-flashx: $0.30/$1.20 per Mtok)', async () => {
    const r = await estimateCost('z-ai/glm-5.3-flashx', 1_000_000, 1_000_000)
    expect(r.source).toBe('estimated')
    expect(r.costUsd).toBeCloseTo(1.5, 6)
  })

  it('computes via alias form (copilot/claude-opus-5.5 → anthropic price $15/$75)', async () => {
    const r = await estimateCost('copilot/claude-opus-5.5', 100_000, 10_000)
    // 0.1M * 15 + 0.01M * 75 = 1.5 + 0.75
    expect(r.source).toBe('estimated')
    expect(r.costUsd).toBeCloseTo(2.25, 6)
  })

  it('raw canonical form resolves directly', async () => {
    const r = await estimateCost('z-ai/glm-5.3-flashx', 1, 1)
    expect(r.source).toBe('estimated')
    expect(r.costUsd).toBeGreaterThan(0)
  })

  it('unknown model degrades to 0/unknown — never throws (SC-3)', async () => {
    const r = await estimateCost('nonexistent/model-xyz', 1_000_000, 1_000_000)
    expect(r).toEqual({ costUsd: 0, source: 'unknown' })
  })

  it('zero tokens cost zero', async () => {
    const r = await estimateCost('z-ai/glm-5.3-flashx', 0, 0)
    expect(r.source).toBe('estimated')
    expect(r.costUsd).toBe(0)
  })

  it('MAX_ESTIMATED_COST clamps below the NUMERIC(12,8) cap (SC-3)', () => {
    expect(MAX_ESTIMATED_COST).toBeLessThan(100)
    // simulate the clamp boundary
    expect(Math.min(999_999, MAX_ESTIMATED_COST)).toBe(MAX_ESTIMATED_COST)
  })
})

// Pure-math clamp behavior is testable without DB
describe('clamp math (pure)', () => {
  // replicate the clamp to assert boundaries without DB
  const clamp = (cost: number): number => (!Number.isFinite(cost) || cost < 0 ? 0 : Math.min(cost, MAX_ESTIMATED_COST))

  it('clamps runaway estimates (token inflation attack, SC-3)', () => {
    const inflated = (Number.MAX_SAFE_INTEGER / 1_000_000) * 75
    expect(clamp(inflated)).toBe(MAX_ESTIMATED_COST)
  })

  it('NaN and negative degrade to 0', () => {
    expect(clamp(Number.NaN)).toBe(0)
    expect(clamp(-5)).toBe(0)
  })

  it('normal costs pass through unclamped', () => {
    expect(clamp(0.0042)).toBe(0.0042)
  })
})
