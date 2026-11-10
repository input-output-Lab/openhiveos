import { describe, it, expect } from 'vitest'
import {
  buildProvenanceMeta,
  extractPersonaClaim,
  META_AGENT_SLUG_KEY,
  META_CLAIMED_PERSONA_KEY,
  META_AUTH_STRENGTH_KEY,
} from '../../packages/mcp-gateway/src/auth-context.js'

// ---------------------------------------------------------------------------
// S19-ARCH-01b (#2775, Tier-3): claim-path hardening. Pins the ONE property
// the audit trail depends on: the gateway's _meta assembly can never be
// overridden by client input. Client _meta spreads FIRST, gateway-resolved
// values LAST — a client attempting to forge a stronger auth path, claim a
// different provenance, or hijack the agent slug always loses the merge.
// ---------------------------------------------------------------------------

describe('S19-ARCH-01b: buildProvenanceMeta overwrite semantics', () => {
  const resolved = { claimedPersona: 'murphy', authStrength: 'dev' as const }

  it('injects all three gateway claims over an empty client _meta', () => {
    const meta = buildProvenanceMeta(undefined, resolved, 'murphy')
    expect(meta[META_AGENT_SLUG_KEY]).toBe('murphy')
    expect(meta[META_CLAIMED_PERSONA_KEY]).toBe('murphy')
    expect(meta[META_AUTH_STRENGTH_KEY]).toBe('dev')
  })

  it('client-supplied __agentSlug is always overwritten', () => {
    const meta = buildProvenanceMeta(
      { __agentSlug: 'elizabeth' },
      resolved,
      'murphy',
    )
    expect(meta[META_AGENT_SLUG_KEY]).toBe('murphy')
  })

  it('client-supplied forged __authStrength always loses to the resolved value', () => {
    const meta = buildProvenanceMeta(
      { __authStrength: 'session' }, // forges the reserved human step-up value
      resolved,
      'murphy',
    )
    expect(meta[META_AUTH_STRENGTH_KEY]).toBe('dev')
  })

  it('client-supplied forged __claimedPersona always loses to the resolved claim', () => {
    const meta = buildProvenanceMeta(
      { __claimedPersona: 'locksmith' },
      resolved,
      'murphy',
    )
    expect(meta[META_CLAIMED_PERSONA_KEY]).toBe('murphy')
  })

  it('client claim in _meta never becomes the claim — claims come from args', () => {
    // The claim path: gateway reads the `persona` TOOL ARGUMENT, never _meta.
    // A client that only stuffs _meta gets no claim at all.
    expect(extractPersonaClaim({})).toBeNull()
    expect(extractPersonaClaim(undefined)).toBeNull()
    const noClaim = { claimedPersona: extractPersonaClaim({}), authStrength: 'bearer' as const }
    const meta = buildProvenanceMeta(
      { __claimedPersona: 'locksmith' },
      noClaim,
      'murphy',
    )
    expect(meta[META_CLAIMED_PERSONA_KEY]).toBeNull()
  })

  it('preserves unrelated client _meta keys (protocol metadata must survive)', () => {
    const meta = buildProvenanceMeta(
      { __clientSurface: 'vscode-copilot', progressToken: 7 },
      resolved,
      'murphy',
    )
    expect(meta['__clientSurface']).toBe('vscode-copilot')
    expect(meta['progressToken']).toBe(7)
  })

  it('null claim serialises as null, not the string "null"', () => {
    const meta = buildProvenanceMeta(undefined, { claimedPersona: null, authStrength: 'bearer' }, 'silas')
    expect(meta[META_CLAIMED_PERSONA_KEY]).toBeNull()
  })
})
