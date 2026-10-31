// ---------------------------------------------------------------------------
// dev-auth guard — S17-BE-06 (task 2637, Tier-3, Locksmith-reviewed).
//
// MCP_GATEWAY_AUTH_DISABLED is a dev convenience that skips per-agent auth.
// 2026-10-30 incident: the flag ran with NODE_ENV=production and every caller
// was mapped to 'elizabeth' — the approver. Two controls came out of that:
//
//   1. assertDevAuthAllowed: the flag is refused at boot when NODE_ENV is
//      production OR the bind is not loopback. Process exits before listen.
//   2. The flag maps dev callers to 'dev-actor' — a manifest-registered slug
//      with no skills, no owned domains, and no token row — never to a
//      privileged persona.
//
// Pure functions so the decision logic is unit-testable without booting
// express. index.ts calls these at module load and inside the middleware.
// ---------------------------------------------------------------------------

export const DEV_ACTOR_SLUG = 'dev-actor'

export interface DevAuthEnv {
  authDisabled: boolean
  nodeEnv: string | undefined
  gatewayBind: string
}

export type DevAuthVerdict =
  | { allowed: true }
  | { allowed: false; reason: string }

/**
 * Decide whether the auth-disabled dev mode may run in this environment.
 * Fail closed: anything ambiguous is refused.
 */
export function assertDevAuthAllowed(env: DevAuthEnv): DevAuthVerdict {
  if (!env.authDisabled) return { allowed: true }

  const isProd = env.nodeEnv === 'production'
  const isLoopback = env.gatewayBind === '127.0.0.1' || env.gatewayBind === 'localhost'
  if (isProd || !isLoopback) {
    return {
      allowed: false,
      reason:
        `[mcp-gateway] FATAL: MCP_GATEWAY_AUTH_DISABLED=true refused (NODE_ENV=${env.nodeEnv ?? 'unset'}, GATEWAY_BIND=${env.gatewayBind}). ` +
        'Dev-auth is only permitted on a loopback bind outside production. Remove the flag and provide real agent tokens.',
    }
  }
  return { allowed: true }
}
