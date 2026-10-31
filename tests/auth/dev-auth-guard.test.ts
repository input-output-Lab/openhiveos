import { describe, it, expect } from 'vitest'
import { assertDevAuthAllowed, DEV_ACTOR_SLUG, type DevAuthEnv } from '../../packages/mcp-gateway/src/dev-auth.js'

// S17-BE-06 (task 2637, Tier-3): the dev-auth guard must refuse the flag in
// production or on non-loopback binds, and never map to a privileged persona.

const env = (over: Partial<DevAuthEnv> = {}): DevAuthEnv => ({
  authDisabled: true,
  nodeEnv: 'development',
  gatewayBind: '127.0.0.1',
  ...over,
})

describe('S17-BE-06: MCP_GATEWAY_AUTH_DISABLED boot guard', () => {
  it('allows the flag on loopback outside production', () => {
    expect(assertDevAuthAllowed(env())).toEqual({ allowed: true })
  })

  it('allows when the flag is absent regardless of environment', () => {
    expect(assertDevAuthAllowed(env({ authDisabled: false, nodeEnv: 'production' }))).toEqual({ allowed: true })
    expect(assertDevAuthAllowed(env({ authDisabled: false, gatewayBind: '0.0.0.0' }))).toEqual({ allowed: true })
  })

  it('refuses the flag when NODE_ENV=production (even on loopback)', () => {
    const v = assertDevAuthAllowed(env({ nodeEnv: 'production' }))
    expect(v.allowed).toBe(false)
    if (!v.allowed) expect(v.reason).toContain('refused')
  })

  it('refuses the flag on a non-loopback bind (even outside production)', () => {
    const v = assertDevAuthAllowed(env({ gatewayBind: '0.0.0.0' }))
    expect(v.allowed).toBe(false)
  })

  it('refuses on any bind that is not exactly loopback (fail closed)', () => {
    for (const bind of ['0.0.0.0', '::', '192.168.1.10', '']) {
      const v = assertDevAuthAllowed(env({ gatewayBind: bind }))
      expect(v.allowed).toBe(false)
    }
  })

  it('treats localhost as loopback', () => {
    expect(assertDevAuthAllowed(env({ gatewayBind: 'localhost' }))).toEqual({ allowed: true })
  })

  it('treats unset NODE_ENV as non-production (dev default), loopback only', () => {
    expect(assertDevAuthAllowed(env({ nodeEnv: undefined }))).toEqual({ allowed: true })
    expect(assertDevAuthAllowed(env({ nodeEnv: undefined, gatewayBind: '0.0.0.0' })).allowed).toBe(false)
  })

  it('dev-actor slug is the non-privileged mapping (never a real persona)', () => {
    expect(DEV_ACTOR_SLUG).toBe('dev-actor')
    expect(DEV_ACTOR_SLUG).not.toBe('elizabeth')
  })
})
