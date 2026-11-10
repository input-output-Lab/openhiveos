import { describe, it, expect } from 'vitest'
import { SessionRegistry } from '../../packages/mcp-gateway/src/session-state.js'

// ---------------------------------------------------------------------------
// S19-ARCH-01c (#2776, Tier-3): session registry + step-up nonce map.
// Pins the fail-closed properties the step-up relay depends on:
//   - session fixation: a stolen header with a different agent gets nothing
//   - nonces are single-use (replay = unknown = decline)
//   - nonce binding: only the minting agent can consume
//   - expiry + dead-session invalidation
// ---------------------------------------------------------------------------

describe('S19-ARCH-01c: SessionRegistry sessions', () => {
  it('registers and resolves a session bound to the agent', () => {
    const r = new SessionRegistry()
    const s = r.register('murphy')
    expect(r.assertSessionAccess(s.sessionId, 'murphy')?.sessionId).toBe(s.sessionId)
  })

  it('rejects session fixation: same header, different agent → null', () => {
    const r = new SessionRegistry()
    const s = r.register('murphy')
    expect(r.assertSessionAccess(s.sessionId, 'elizabeth')).toBeNull()
  })

  it('rejects unknown session ids', () => {
    const r = new SessionRegistry()
    expect(r.assertSessionAccess('nonexistent', 'murphy')).toBeNull()
  })

  it('end() removes the session', () => {
    const r = new SessionRegistry()
    const s = r.register('murphy')
    r.end(s.sessionId)
    expect(r.assertSessionAccess(s.sessionId, 'murphy')).toBeNull()
    expect(r.sessionCount()).toBe(0)
  })

  it('end() invalidates pending step-ups bound to the dead session', () => {
    const r = new SessionRegistry()
    const s = r.register('murphy')
    const nonce = r.mintNonce(s.sessionId, 'murphy')
    r.end(s.sessionId)
    expect(r.consumeNonce(nonce, 'murphy')).toBeNull()
  })
})

describe('S19-ARCH-01c: step-up nonces', () => {
  it('mints and consumes exactly once — replay is unknown', () => {
    const r = new SessionRegistry()
    const s = r.register('murphy')
    const nonce = r.mintNonce(s.sessionId, 'murphy')
    const first = r.consumeNonce(nonce, 'murphy')
    expect(first?.sessionId).toBe(s.sessionId)
    expect(r.consumeNonce(nonce, 'murphy')).toBeNull() // replayed
  })

  it('binds the nonce to the minting agent — a wrong agent consumes it without using it', () => {
    const r = new SessionRegistry()
    const s = r.register('murphy')
    const nonce = r.mintNonce(s.sessionId, 'murphy')
    expect(r.consumeNonce(nonce, 'elizabeth')).toBeNull()
    // Deliberately single-use on ANY attempt (fail-closed): a wrong-agent
    // probe burns the nonce — the original agent cannot use it either, and
    // probing cannot brute-force a live nonce.
    expect(r.consumeNonce(nonce, 'murphy')).toBeNull()
  })

  it('unknown nonces are null (fabricated nonce → gateway declines)', () => {
    const r = new SessionRegistry()
    expect(r.consumeNonce('deadbeef', 'murphy')).toBeNull()
  })

  it('expired nonces are null', () => {
    const r = new SessionRegistry()
    const s = r.register('murphy')
    const nonce = r.mintNonce(s.sessionId, 'murphy')
    // Force expiry directly on the internal map via a subclass-free trick:
    // sweep only happens on mint, so mutate time by exhausting TTL manually.
    // Simpler: mint, then walk the private map through the public surface —
    // instead use a tiny TTL via constructor sweep + timestamp manipulation
    // is not exposed; verify via the expiry branch with vi.useFakeTimers.
    const future = Date.now() + 11 * 60_000
    const realNow = Date.now
    Date.now = () => future
    try {
      expect(r.consumeNonce(nonce, 'murphy')).toBeNull()
    } finally {
      Date.now = realNow
    }
  })
})

describe('S19-ARCH-01c: idle session sweep', () => {
  it('sweeps sessions idle beyond the TTL on the next registry operation', () => {
    const r = new SessionRegistry(0) // sweep every op
    const s = r.register('murphy')
    const realNow = Date.now
    Date.now = () => realNow() + 31 * 60_000
    try {
      r.register('elizabeth') // triggers sweep
      expect(r.assertSessionAccess(s.sessionId, 'murphy')).toBeNull()
    } finally {
      Date.now = realNow
    }
  })
})
