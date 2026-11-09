// ---------------------------------------------------------------------------
// auth-context — S19-ARCH-01a (#2774): claimed-persona + auth-strength audit.
//
// ARCH-026 Decision 1: every audit row carries a claimed persona label and
// the authentication strength that produced the actor attribution.
//
//   claimed_persona — the LLM-supplied `persona` tool argument, lifted by
//     the gateway into _meta.__claimedPersona and persisted on audit rows.
//     SPOOFABLE BY DESIGN (Founder-ratified risk, ARCH-026): it is a label
//     for humans reading the audit trail, never a control.
//   auth_strength   — the auth path: 'bearer' (per-agent token), 'dev'
//     (auth-disabled flag → non-privileged dev-actor, S17-BE-06),
//     'shared_token' (legacy /sse Bridge token), 'session' (RESERVED for
//     01c human step-up — nothing emits it yet), 'unverified' (legacy rows).
//
// Locksmith note: `persona` is the ONLY argument VALUE the gateway persists.
// This is the sanctioned carve-out to the #2543 "never store arg values"
// condition — ARCH-026 Decision 1 explicitly requires the claim on the audit
// row. Everything else stays keys-only + args_hash. Tier-3 review on merge
// covers this carve-out.
//
// Pure functions, no I/O — unit-testable without booting express (same
// pattern as dev-auth.ts). The value domain MUST stay in lockstep with the
// chk_*_auth_strength CHECK constraints in
// migrations/031_identity_audit_columns.sql.
// ---------------------------------------------------------------------------

export const AUTH_STRENGTH_VALUES = [
  'bearer',
  'shared_token',
  'dev',
  'session',
  'unverified',
] as const

export type AuthStrength = (typeof AUTH_STRENGTH_VALUES)[number]

/** Tool argument carrying the persona claim (ARCH-026 Decision 1). */
export const PERSONA_CLAIM_ARG = 'persona'

// Must stay in lockstep with chk_*_claimed_persona in migration 031 and the
// withActor() validation in src/db/client.ts: lowercase slug-shape, ≤64 chars.
const PERSONA_CLAIM_RE = /^[a-z][a-z0-9_-]{0,63}$/

/** Identity columns appended to every tool_invocations row. */
export interface IdentityAudit {
  claimedPersona: string | null
  authStrength: AuthStrength
}

export function isValidPersonaClaim(value: unknown): value is string {
  return typeof value === 'string' && PERSONA_CLAIM_RE.test(value)
}

/**
 * Extract the persona claim from tool arguments. Absent or malformed claims
 * yield null — a malformed claim must never fail the fire-and-forget
 * tool_invocations INSERT (the CHECK domain would reject it).
 */
export function extractPersonaClaim(
  args: Record<string, unknown> | null | undefined,
): string | null {
  if (!args || typeof args !== 'object') return null
  const raw = args[PERSONA_CLAIM_ARG]
  return isValidPersonaClaim(raw) ? raw : null
}

/** Default identity attribution when no authenticated path is known. */
export const UNVERIFIED_IDENTITY: IdentityAudit = {
  claimedPersona: null,
  authStrength: 'unverified',
}

// _meta keys the gateway injects into every proxied call. Clients MAY send
// these keys; the gateway ALWAYS overwrites them — provenance of every
// injected claim is the gateway's own resolution, never client input.
// (Same sideband as __agentSlug / __clientSurface, ARCH-021.)
export const META_AGENT_SLUG_KEY = '__agentSlug'
export const META_CLAIMED_PERSONA_KEY = '__claimedPersona'
export const META_AUTH_STRENGTH_KEY = '__authStrength'

/**
 * Build the _meta sideband the gateway forwards to the subprocess for one
 * proxied call. Single construction site (S19-ARCH-01b hardening): spread
 * order is client _meta FIRST, gateway claims LAST, so a client-supplied
// __claimedPersona / __authStrength / __agentSlug can never survive the
 * merge. Claim is null-able — extractPersonaClaim already normalised it.
 */
export function buildProvenanceMeta(
  clientMeta: Record<string, unknown> | undefined,
  resolved: IdentityAudit,
  agentSlug: string,
): Record<string, unknown> {
  return {
    ...(clientMeta ?? {}),
    [META_AGENT_SLUG_KEY]: agentSlug,
    [META_CLAIMED_PERSONA_KEY]: resolved.claimedPersona,
    [META_AUTH_STRENGTH_KEY]: resolved.authStrength,
  }
}
