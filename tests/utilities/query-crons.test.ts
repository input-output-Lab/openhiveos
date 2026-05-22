/**
 * tests/utilities/query-crons.test.ts
 *
 * S7-02: unit tests for queryCronsSchema.strict()
 *
 * Verifies that the MCP SDK's failure to strip unknown keys at the handler
 * boundary is covered by Zod's .strict() — unknown keys are rejected at
 * parse time rather than silently discarded.
 */

import { describe, it, expect } from 'vitest'
import { queryCronsSchema } from '../../src/utilities/query-crons.js'

describe('queryCronsSchema (.strict())', () => {
  it('accepts an empty object', () => {
    expect(() => queryCronsSchema.parse({})).not.toThrow()
  })

  it('accepts all valid optional fields', () => {
    expect(() =>
      queryCronsSchema.parse({
        project_id: 1,
        status: 'active',
        owner_agent_slug: 'murphy',
      }),
    ).not.toThrow()
  })

  it('accepts a subset of valid fields', () => {
    expect(() => queryCronsSchema.parse({ status: 'paused' })).not.toThrow()
  })

  it('rejects an unknown key — .strict() surfaces the error instead of silently discarding', () => {
    // Without .strict(), Zod would silently strip 'rogue_key' and parse successfully.
    // With .strict(), this is a parse error — consistent with all mutation schemas.
    expect(() =>
      queryCronsSchema.parse({ project_id: 1, rogue_key: 'injected' }),
    ).toThrow()
  })

  it('rejects multiple unknown keys', () => {
    expect(() =>
      queryCronsSchema.parse({ status: 'active', a: 1, b: 2 }),
    ).toThrow()
  })

  it('rejects an invalid status value', () => {
    expect(() => queryCronsSchema.parse({ status: 'unknown' })).toThrow()
  })

  it('rejects a non-positive project_id', () => {
    expect(() => queryCronsSchema.parse({ project_id: 0 })).toThrow()
    expect(() => queryCronsSchema.parse({ project_id: -1 })).toThrow()
  })
})
