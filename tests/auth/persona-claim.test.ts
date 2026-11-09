import { describe, it, expect } from 'vitest'
import {
  extractPersonaClaim,
  isValidPersonaClaim,
  AUTH_STRENGTH_VALUES,
  UNVERIFIED_IDENTITY,
  PERSONA_CLAIM_ARG,
} from '../../packages/mcp-gateway/src/auth-context.js'

// ---------------------------------------------------------------------------
// S19-ARCH-01a (#2774, Tier-3): persona-claim extraction for the gateway
// audit recorder. The claim is spoofable by design (ARCH-026, Founder-
// ratified) — these tests pin the LABEL semantics: shape, absence, and
// never-fail behaviour (a malformed claim must not break the fire-and-forget
// tool_invocations INSERT).
// ---------------------------------------------------------------------------

describe('S19-ARCH-01a: isValidPersonaClaim shape', () => {
  it('accepts manifest-shaped slugs', () => {
    expect(isValidPersonaClaim('murphy')).toBe(true)
    expect(isValidPersonaClaim('dev-actor')).toBe(true)
    expect(isValidPersonaClaim('agent_1')).toBe(true)
  })

  it('rejects non-strings, empty, uppercase, and leading-digit claims', () => {
    expect(isValidPersonaClaim(undefined)).toBe(false)
    expect(isValidPersonaClaim(null)).toBe(false)
    expect(isValidPersonaClaim(42)).toBe(false)
    expect(isValidPersonaClaim('')).toBe(false)
    expect(isValidPersonaClaim('Murphy')).toBe(false)
    expect(isValidPersonaClaim('1murphy')).toBe(false)
    expect(isValidPersonaClaim('has space')).toBe(false)
  })

  it('rejects claims over 64 chars', () => {
    expect(isValidPersonaClaim('a'.repeat(64))).toBe(true)
    expect(isValidPersonaClaim('a'.repeat(65))).toBe(false)
  })
})

describe('S19-ARCH-01a: extractPersonaClaim from tool arguments', () => {
  it('extracts the persona argument when valid', () => {
    expect(extractPersonaClaim({ persona: 'murphy', task_id: 1 })).toBe('murphy')
  })

  it('returns null when absent', () => {
    expect(extractPersonaClaim({ task_id: 1 })).toBeNull()
    expect(extractPersonaClaim(null)).toBeNull()
    expect(extractPersonaClaim(undefined)).toBeNull()
  })

  it('returns null for malformed claims — never throws, never returns the raw value', () => {
    expect(extractPersonaClaim({ persona: 'Not A Slug' })).toBeNull()
    expect(extractPersonaClaim({ persona: 42 })).toBeNull()
    expect(extractPersonaClaim({ persona: { inner: 'object' } })).toBeNull()
  })

  it('only reads the canonical persona key', () => {
    expect(extractPersonaClaim({ Persona: 'murphy' })).toBeNull()
    expect(extractPersonaClaim({ agentSlug: 'murphy' })).toBeNull()
    expect(PERSONA_CLAIM_ARG).toBe('persona')
  })
})

describe('S19-ARCH-01a: auth strength value domain', () => {
  it('keeps the value domain in lockstep with migration 031 CHECK constraints', () => {
    expect([...AUTH_STRENGTH_VALUES].sort()).toEqual(
      ['bearer', 'dev', 'session', 'shared_token', 'unverified'].sort(),
    )
  })

  it('session is present but reserved — nothing may emit it until 01c ships', () => {
    // Documented in auth-context.ts and migration 031; enforced by review.
    expect(AUTH_STRENGTH_VALUES).toContain('session')
  })

  it('defaults to unverified attribution', () => {
    expect(UNVERIFIED_IDENTITY).toEqual({ claimedPersona: null, authStrength: 'unverified' })
  })
})
