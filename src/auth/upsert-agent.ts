/**
 * src/auth/upsert-agent.ts
 *
 * Shared agent provisioning module — ARCH-014 C2 (#1369).
 *
 * Extracted from scripts/provision-agent-token.ts to prevent logic drift
 * between single-agent and batch provisioning paths.
 *
 * Exports:
 *   checkEthosSealGate(client)  — fails-closed if no active seal (SEC-C5)
 *   generateToken()             — produces salt, secret, hash, wire token
 *   upsertAgent(client, params) — single upsert; DO NOTHING or DO UPDATE
 *
 * Security conditions (Locksmith, ARCH-014):
 *   SEC-C1 — token_hash uses SHA-256 (not bcrypt)
 *   SEC-C2 — forceRotate=false → DO NOTHING; forceRotate=true → DO UPDATE
 *   SEC-C5 — Ethos Seal gate: fail-closed; 42P01 handled explicitly
 *   SEC-C7 — revoke uses UPDATE active=false, never DELETE
 *   SEC-C8 — UNIQUE on agents.token_hash confirmed in 001_init.sql
 *
 * Token format (ARCH-008 Decision 7):
 *   wire:  <32-hex-salt>.<64-hex-secret>
 *   hash:  SHA-256(salt + secret)  →  stored in agents.token_hash
 *   salt and secret have fixed, distinct lengths — concatenation is unambiguous.
 */

import { createHash, randomBytes } from 'node:crypto'
import type { PoolClient } from 'pg'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface UpsertAgentParams {
  slug: string
  displayName: string
  /**
   * true  → ON CONFLICT DO UPDATE — rotates the token with a 1h grace window.
   *          Use for single-agent explicit provisioning.
   * false → ON CONFLICT DO NOTHING — skips if the agent is already provisioned.
   *          Default for batch provisioning (SEC-C2: no accidental mass rotation).
   */
  forceRotate: boolean
}

export type UpsertAgentResult =
  | { skipped: true }               // agent existed and forceRotate=false
  | { skipped: false; token: string } // new token generated and stored

// ---------------------------------------------------------------------------
// Ethos Seal gate — SEC-C5
//
// Provision scripts must not run against an uninitialised database.
// The gate enforces: one-init → provision ordering in code (not Compose graph).
//
// Exits immediately on:
//   - Zero active seal rows  → operator has not run one-init
//   - 42P01 (undefined_table) → migrations have not been applied
//   - Any other DB error
// ---------------------------------------------------------------------------

/** PostgreSQL error code: undefined_table — relation does not exist. */
const PG_UNDEFINED_TABLE = '42P01'

function isPgError(err: unknown, code: string): boolean {
  return err instanceof Error && 'code' in err && (err as { code: string }).code === code
}

export async function checkEthosSealGate(client: PoolClient): Promise<void> {
  try {
    const result = await client.query(
      `SELECT 1 FROM ethos_seals WHERE is_active = TRUE LIMIT 1`,
    )
    if ((result.rowCount ?? 0) === 0) {
      console.error('[upsert-agent] Error: No active Ethos Seal found.')
      console.error('[upsert-agent] The squad has not been initialised.')
      console.error('[upsert-agent] Run: docker compose --profile init run --rm one-init')
      process.exit(1)
    }
  } catch (err) {
    if (isPgError(err, PG_UNDEFINED_TABLE)) {
      // ethos_seals table does not exist — migrations have not been applied.
      console.error('[upsert-agent] Error: ethos_seals table does not exist.')
      console.error('[upsert-agent] Migrations have not been applied.')
      console.error('[upsert-agent] Run: docker compose run --rm migrate')
      process.exit(1)
    }
    const message = err instanceof Error ? err.message : String(err)
    console.error('[upsert-agent] DB error checking Ethos Seal gate:', message)
    process.exit(1)
  }
}

// ---------------------------------------------------------------------------
// Token generation — SEC-C1 (SHA-256, not bcrypt)
// ---------------------------------------------------------------------------

export interface GeneratedToken {
  salt: string     // 32 hex chars (16 bytes)
  secret: string   // 64 hex chars (32 bytes — 256-bit entropy)
  tokenHash: string // SHA-256(salt + secret) — stored in agents.token_hash
  agentToken: string // wire format: <salt>.<secret>
}

/**
 * Generates a new agent token.
 * The secret never touches the database — only tokenHash is stored (SEC-C1).
 */
export function generateToken(): GeneratedToken {
  const salt = randomBytes(16).toString('hex')    // 32 hex chars
  const secret = randomBytes(32).toString('hex')  // 64 hex chars — 256-bit
  const tokenHash = createHash('sha256').update(salt + secret).digest('hex')
  const agentToken = `${salt}.${secret}`
  return { salt, secret, tokenHash, agentToken }
}

// ---------------------------------------------------------------------------
// Upsert SQL — two variants (SEC-C2)
// ---------------------------------------------------------------------------

/**
 * forceRotate=false: insert new agent; skip silently if slug already exists.
 * Used by: provision-all-agents.ts (batch path — no accidental mass rotation).
 *
 * RETURNING id allows us to detect whether a row was inserted or skipped:
 *   - row returned → inserted (not skipped)
 *   - no rows      → conflict (skipped)
 */
const UPSERT_DO_NOTHING_SQL = `
  INSERT INTO agents (slug, display_name, token_hash, token_salt, active, updated_at)
  VALUES ($1, $2, $3, $4, true, NOW())
  ON CONFLICT (slug) DO NOTHING
  RETURNING id
`

/**
 * forceRotate=true: insert or rotate. Existing token moves to grace-period
 * slot (1h window) so in-flight connections finish without error.
 * Used by: provision-agent-token.ts (single-agent explicit path).
 */
const UPSERT_DO_UPDATE_SQL = `
  INSERT INTO agents (slug, display_name, token_hash, token_salt, active, updated_at)
  VALUES ($1, $2, $3, $4, true, NOW())
  ON CONFLICT (slug) DO UPDATE SET
    previous_token_hash       = agents.token_hash,
    previous_token_salt       = agents.token_salt,
    previous_token_expires_at = NOW() + INTERVAL '1 hour',
    token_hash                = EXCLUDED.token_hash,
    token_salt                = EXCLUDED.token_salt,
    active                    = true,
    updated_at                = NOW()
  RETURNING id
`

// ---------------------------------------------------------------------------
// upsertAgent — main export
// ---------------------------------------------------------------------------

/**
 * Provisions or rotates an agent token.
 *
 * The caller is responsible for:
 *   1. Acquiring the PoolClient (and releasing it in a finally block).
 *   2. Calling checkEthosSealGate(client) before the first upsertAgent call.
 *      (Do it once per session, not once per agent in a batch loop.)
 *
 * @param client  - Active PoolClient — no transaction required (upsert is atomic)
 * @param params  - slug, displayName, forceRotate
 * @returns UpsertAgentResult — discriminated union: skipped or { token }
 */
export async function upsertAgent(
  client: PoolClient,
  params: UpsertAgentParams,
): Promise<UpsertAgentResult> {
  const { slug, displayName, forceRotate } = params
  const { salt, tokenHash, agentToken } = generateToken()

  const sql = forceRotate ? UPSERT_DO_UPDATE_SQL : UPSERT_DO_NOTHING_SQL
  const result = await client.query<{ id: number }>(sql, [slug, displayName, tokenHash, salt])

  if ((result.rowCount ?? 0) === 0) {
    // ON CONFLICT DO NOTHING fired — agent already provisioned, row unchanged.
    return { skipped: true }
  }

  return { skipped: false, token: agentToken }
}
