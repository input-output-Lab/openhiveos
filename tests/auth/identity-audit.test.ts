import { describe, it, expect } from 'vitest'
import { extractIdentityAudit } from '../../src/auth/identity.js'

// ---------------------------------------------------------------------------
// S19-ARCH-01a (#2774, Tier-3): subprocess-side extraction of the identity
// audit context from _meta. Pins the fail-safe rule: an absent or malformed
// __authStrength degrades to 'unverified' — an audit row must never look
// stronger than the evidence. The gateway overwrites both values before the
// subprocess sees them; these tests pin what happens when it doesn't.
// ---------------------------------------------------------------------------

describe('S19-ARCH-01a: extractIdentityAudit from _meta', () => {
  it('extracts both values when the gateway injected valid ones', () => {
    const ctx = extractIdentityAudit({
      _meta: { __claimedPersona: 'murphy', __authStrength: 'bearer' },
    })
    expect(ctx).toEqual({ claimedPersona: 'murphy', authStrength: 'bearer' })
  })

  it('degrades to unverified when _meta is absent entirely', () => {
    expect(extractIdentityAudit({})).toEqual({ claimedPersona: null, authStrength: 'unverified' })
    expect(extractIdentityAudit({ _meta: undefined })).toEqual({
      claimedPersona: null,
      authStrength: 'unverified',
    })
  })

  it('degrades a spoofed auth strength to unverified', () => {
    // A client raw _meta attempt to look bearer-verified must collapse —
    // the gateway overwrites it in the honest path; if a value ever leaks
    // through unvalidated, the audit understates rather than inflates.
    const ctx = extractIdentityAudit({ _meta: { __authStrength: 'session' } })
    expect(ctx.authStrength).toBe('session') // known value passes shape check
    // unknown values collapse:
    expect(extractIdentityAudit({ _meta: { __authStrength: 'totally-fake' } }).authStrength).toBe('unverified')
    expect(extractIdentityAudit({ _meta: { __authStrength: 42 } }).authStrength).toBe('unverified')
  })

  it('nulls malformed persona claims without throwing', () => {
    expect(extractIdentityAudit({ _meta: { __claimedPersona: 'Bad Slug' } }).claimedPersona).toBeNull()
    expect(extractIdentityAudit({ _meta: { __claimedPersona: 7 } }).claimedPersona).toBeNull()
  })

  it('records a claim for an unknown persona — claims are audit facts, not registry lookups', () => {
    const ctx = extractIdentityAudit({
      _meta: { __claimedPersona: 'ghost-persona', __authStrength: 'dev' },
    })
    expect(ctx.claimedPersona).toBe('ghost-persona')
    expect(ctx.authStrength).toBe('dev')
  })
})
