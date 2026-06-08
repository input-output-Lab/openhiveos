import { createHash } from 'node:crypto'
import { config } from '../config.js'
import { pool } from '../db/client.js'
import { isValidAgentSlug } from '../squad/manifest.js'
import { compareTokenHash } from './token-comparison.js'

// ---------------------------------------------------------------------------
// Agent identity resolution — ARCH-008 Decision 7 + ARCH-021
//
// Two modes:
//
// 1. Boot-time (standalone): resolveIdentity()
//    Called once at boot (Step 4 of 6). Reads AGENT_TOKEN from env.
//    The returned agentSlug is closed over in all handler registrations.
//    The process halts if resolution fails.
//
// 2. Per-call (GATEWAY_MODE): extractGatewaySlug(extra)
//    Called on every tool invocation when GATEWAY_MODE=true.
//    Reads __agentSlug from extra._meta (injected by the gateway into the
//    _meta protocol sideband — NOT from tool arguments).
//    Throws if __agentSlug is absent or not in squad.manifest.json.
//
// Token format: <32-hex-salt>.<64-hex-secret>
//   Salt:   crypto.randomBytes(16).toString('hex') — 32 hex chars
//   Secret: crypto.randomBytes(32).toString('hex') — 64 hex chars (256-bit entropy)
//   Hash:   SHA-256(salt + secret) stored in agents.token_hash
//
// Comparison: timingSafeEqual on Buffer — never === or string comparison.
// ---------------------------------------------------------------------------

interface AgentRow {
  slug: string
  token_hash: string
  previous_token_hash: string | null
  active: boolean
  expires_at: Date | null
}

// Runtime whitelist — guards against column-name injection if TypeScript types
// are bypassed by a future refactor or unsafe cast (SHOULD-FIX-2).
const ALLOWED_TOKEN_COLUMNS = new Set<string>([
  'token_hash',
  'previous_token_hash',
])

function parseToken(raw: string): { salt: string; secret: string } | null {
  const dot = raw.indexOf('.')
  if (dot === -1) return null

  const salt = raw.slice(0, dot)
  const secret = raw.slice(dot + 1)

  // Enforce exact lengths: 32-char hex salt, 64-char hex secret
  if (salt.length !== 32 || secret.length !== 64) return null
  if (!/^[\da-f]+$/i.test(salt) || !/^[\da-f]+$/i.test(secret)) return null

  return { salt, secret }
}

function computeHash(salt: string, secret: string): Buffer {
  const hex = createHash('sha256').update(salt + secret).digest('hex')
  return Buffer.from(hex, 'hex')
}

async function lookupByHash(
  hashHex: string,
  column: 'token_hash' | 'previous_token_hash',
): Promise<AgentRow | null> {
  // Runtime guard — SHOULD-FIX-2: defend against column injection if the
  // TypeScript union is ever bypassed by an unsafe cast or future refactor.
  if (!ALLOWED_TOKEN_COLUMNS.has(column)) {
    throw new Error(`[auth] Internal error: invalid token column "${column}"`)
  }

  const gracePeriodClause =
    column === 'previous_token_hash'
      ? 'AND previous_token_expires_at > NOW()'
      : ''

  const { rows } = await pool.query<AgentRow>(
    `SELECT slug, token_hash, previous_token_hash, active, expires_at
       FROM agents
      WHERE ${column} = $1
        AND active = true
        ${gracePeriodClause}
      LIMIT 1`,
    [hashHex],
  )

  return rows[0] ?? null
}

// ---------------------------------------------------------------------------
// resolveIdentity
//
// Parses AGENT_TOKEN, hashes it, looks up the matching agent row, and
// returns the agent slug. Throws on any failure — the process must halt.
// ---------------------------------------------------------------------------
export async function resolveIdentity(): Promise<string> {
  const rawToken = config.AGENT_TOKEN
  if (!rawToken) {
    throw new Error(
      '[auth] AGENT_TOKEN is not set — cannot resolve identity in standalone mode',
    )
  }
  const parsed = parseToken(rawToken)
  if (!parsed) {
    throw new Error(
      '[auth] AGENT_TOKEN format invalid — expected <32-hex-salt>.<64-hex-secret>',
    )
  }

  const { salt, secret } = parsed
  const candidateHash = computeHash(salt, secret)
  const candidateHashHex = candidateHash.toString('hex')

  // Primary lookup by current token
  let row = await lookupByHash(candidateHashHex, 'token_hash')
  let usingGracePeriod = false

  // Grace-period rotation: fall back to previous_token_hash if within expiry window
  if (!row) {
    row = await lookupByHash(candidateHashHex, 'previous_token_hash')
    usingGracePeriod = true
  }

  if (!row) {
    throw new Error(
      '[auth] AGENT_TOKEN not recognised — no matching active agent in database',
    )
  }

  // Defence-in-depth: constant-time comparison even after indexed lookup.
  //
  // BLOCKING BUG FIX (S2-02): during grace-period rotation, the row is found
  // via previous_token_hash. row.token_hash holds the NEW token's hash, not
  // the one we matched. We must compare candidateHash against the hash that
  // was actually used to locate this row, not the primary token_hash.
  const matchedHashHex = usingGracePeriod
    ? row.previous_token_hash
    : row.token_hash

  if (matchedHashHex === null) {
    throw new Error('[auth] AGENT_TOKEN internal error: matched hash is null')
  }

  // Timing-safe comparison via shared token-comparison module (ARCH-008 universal rule)
  if (!compareTokenHash(matchedHashHex, candidateHash)) {
    throw new Error('[auth] AGENT_TOKEN constant-time comparison failed')
  }

  // Token expiry check (expires_at is nullable — null means no expiry)
  if (row.expires_at !== null && row.expires_at <= new Date()) {
    throw new Error('[auth] AGENT_TOKEN has expired')
  }

  // Cross-reference with squad.manifest.json — DB and manifest must agree
  if (!isValidAgentSlug(row.slug)) {
    throw new Error(
      `[auth] Agent "${row.slug}" found in DB but not registered in squad.manifest.json`,
    )
  }

  // Update last_used_at — fire and forget, does not block boot
  void pool
    .query('UPDATE agents SET last_used_at = NOW() WHERE slug = $1', [row.slug])
    .catch(() => {
      // Non-fatal: boot succeeds even if last_used_at update fails
    })

  return row.slug
}

// ---------------------------------------------------------------------------
// extractGatewaySlug — ARCH-021 per-call identity in GATEWAY_MODE
//
// Reads __agentSlug from request._meta (injected by the gateway into the
// _meta protocol sideband — NOT from tool arguments).
//
// Why _meta and not arguments:
//   The MCP SDK's McpServer.registerTool handler receives args that have
//   already been parsed by safeParseAsync against the tool's inputSchema
//   (z4mini.object, Zod v4 strip mode). Unknown keys — including __agentSlug
//   — are silently removed before the handler is invoked. _meta is part of
//   request.params and is passed through to handlers via the `extra` second
//   argument, bypassing inputSchema validation entirely.
//
// extra._meta is typed as { [key: string]: unknown } | undefined in the SDK.
// Throws if __agentSlug is absent or not registered in squad.manifest.json.
// ---------------------------------------------------------------------------
export function extractGatewaySlug(extra: { _meta?: Record<string, unknown> }): string {
  const slug = extra._meta?.['__agentSlug']

  if (typeof slug !== 'string' || slug.length === 0) {
    throw new Error(
      '[auth] GATEWAY_MODE: __agentSlug missing from tool call arguments',
    )
  }

  if (!isValidAgentSlug(slug)) {
    throw new Error(
      `[auth] GATEWAY_MODE: __agentSlug "${slug}" is not registered in squad.manifest.json`,
    )
  }

  return slug
}
