// ---------------------------------------------------------------------------
// session-state — S19-ARCH-01c (#2776): gateway session registry + step-up
// nonce map. ARCH-028 (draft): the stateful machinery the step-up relay
// needs. Pure data structures with TTL sweeping — no I/O, unit-testable.
//
// Threat model notes:
//   - Sessions are bound to an agent slug at initialize time. Every POST
//     must present BOTH the session header AND a bearer resolving to the
//     SAME slug — session fixation (stolen header, different token) is a
//     404 at the boundary (checked by the /mcp handler, enforced by
//     assertSessionAccess here).
//   - Nonces are single-use: consume() removes them. A replayed nonce is an
//     unknown nonce → decline (fail-closed).
//   - Everything expires: sessions by idle TTL sweep, nonces by absolute
//     TTL sweep. The maps cannot grow unboundedly.
// ---------------------------------------------------------------------------

import { randomBytes } from 'node:crypto'

/** The downstream protocol pair for one client session (S19-ARCH-01c-R1, FIND-2 fix).
 *  StreamableHTTP stateful mode requires the SAME transport instance across
 *  every request of a session — a fresh instance rejects non-initialize
 *  requests (SDK validateSession: !initialized → 400). */
export interface SessionPair {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  server: any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  transport: any
}

export interface GatewaySession {
  sessionId: string
  agentSlug: string
  createdAt: number
  lastSeenAt: number
  /** Attached after createSession(); present for the life of the session. */
  pair?: SessionPair | undefined
}

const SESSION_IDLE_TTL_MS = 30 * 60_000 // 30 min idle → swept
const NONCE_TTL_MS = 10 * 60_000 // step-up must complete within 10 min

interface PendingStepUp {
  sessionId: string
  agentSlug: string
  expiresAt: number
}

export class SessionRegistry {
  private readonly sessions = new Map<string, GatewaySession>()
  private readonly pendingNonces = new Map<string, PendingStepUp>()
  private lastSweep = Date.now()
  private readonly sweepIntervalMs: number

  constructor(sweepIntervalMs = 60_000) {
    this.sweepIntervalMs = sweepIntervalMs
  }

  /** Register a session freshly initialized by `agentSlug`. */
  register(agentSlug: string): GatewaySession {
    this.maybeSweep()
    const session: GatewaySession = {
      sessionId: randomBytes(24).toString('hex'),
      agentSlug,
      createdAt: Date.now(),
      lastSeenAt: Date.now(),
    }
    this.sessions.set(session.sessionId, session)
    return session
  }

  /** Attach the protocol pair after building server+transport for the session. */
  attachPair(sessionId: string, pair: SessionPair): void {
    const s = this.sessions.get(sessionId)
    if (s) s.pair = pair
  }

  getPair(sessionId: string): SessionPair | undefined {
    return this.sessions.get(sessionId)?.pair
  }

  get(sessionId: string): GatewaySession | undefined {
    return this.sessions.get(sessionId)
  }

  /** Touch on activity so idle TTL reflects real usage. */
  touch(sessionId: string): void {
    const s = this.sessions.get(sessionId)
    if (s) s.lastSeenAt = Date.now()
  }

  /**
   * Session-fixation guard: the session must exist AND belong to the agent
   * the bearer resolved. Fail-closed — anything ambiguous is a miss.
   */
  assertSessionAccess(sessionId: string, agentSlug: string): GatewaySession | null {
    const s = this.sessions.get(sessionId)
    if (!s || s.agentSlug !== agentSlug) return null
    this.touch(sessionId)
    return s
  }

  end(sessionId: string): void {
    this.sessions.delete(sessionId)
    // Invalidate any pending step-ups bound to the dead session.
    for (const [nonce, p] of this.pendingNonces) {
      if (p.sessionId === sessionId) this.pendingNonces.delete(nonce)
    }
    // Close the downstream transport so the client's GET stream terminates
    // (onclose fires client-side; reconnect re-initializes).
    const pair = this.sessions.get(sessionId)?.pair
    if (pair) {
      void pair.transport.close().catch(() => {})
      this.sessions.get(sessionId)!.pair = undefined
    }
  }

  /**
   * Mint a step-up nonce bound to {session, agent}. Returns the nonce to
   * inject into _meta.__stepUpNonce for the outgoing callTool.
   */
  mintNonce(sessionId: string, agentSlug: string): string {
    this.maybeSweep()
    const nonce = randomBytes(16).toString('hex')
    this.pendingNonces.set(nonce, {
      sessionId,
      agentSlug,
      expiresAt: Date.now() + NONCE_TTL_MS,
    })
    return nonce
  }

  /**
   * Consume a nonce presented on an inbound elicitation. Single-use:
   * valid only when unexpired AND the presenting agent matches the minting
   * agent. Any miss → null (the relay declines).
   */
  consumeNonce(nonce: string, agentSlug: string): PendingStepUp | null {
    const p = this.pendingNonces.get(nonce)
    this.pendingNonces.delete(nonce) // single-use regardless of outcome
    if (!p) return null
    if (p.expiresAt <= Date.now()) return null
    if (p.agentSlug !== agentSlug) return null
    // Session may have died between mint and elicitation — that's a decline.
    if (!this.sessions.has(p.sessionId)) return null
    return p
  }

  /**
   * Consume a nonce WITHOUT an agent assertion (S19-ARCH-01c-R1): used by
   * the upstream relay, which receives elicitation from the subprocess —
   * the only party that legitimately holds the nonce. The owning agent is
   * DERIVED from the mint-time binding, not asserted by the presenter, so
   * there is no spoofable field in the loop. Still single-use
   * (burn-on-any-attempt) and expiry-checked; a dead owning session → null.
   */
  consumeNonceByNonceOnly(nonce: string): PendingStepUp | null {
    const p = this.pendingNonces.get(nonce)
    this.pendingNonces.delete(nonce) // single-use regardless of outcome
    if (!p) return null
    if (p.expiresAt <= Date.now()) return null
    if (!this.getPair(p.sessionId)) return null
    return p
  }

  pendingCount(): number {
    return this.pendingNonces.size
  }

  sessionCount(): number {
    return this.sessions.size
  }

  private maybeSweep(): void {
    const now = Date.now()
    if (now - this.lastSweep < this.sweepIntervalMs) return
    this.lastSweep = now
    const stale: string[] = []
    for (const [id, s] of this.sessions) {
      if (now - s.lastSeenAt > SESSION_IDLE_TTL_MS) stale.push(id)
    }
    for (const id of stale) this.end(id)
    for (const [nonce, p] of this.pendingNonces) {
      if (p.expiresAt <= now) this.pendingNonces.delete(nonce)
    }
  }
}
