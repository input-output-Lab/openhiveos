import { randomBytes, createHash, timingSafeEqual } from 'node:crypto'
import type { Request, Response, NextFunction } from 'express'
import type { Pool } from 'pg'

// ---------------------------------------------------------------------------
// Dashboard session auth (S18-SEC-03, #2642)
//
// Retires the build-time-baked VITE_DASHBOARD_AGENT_TOKEN
// (Locksmith condition, 2026-10-30 identity review: "bearer-in-bundle
// retired on any production path").
//
// Flow:
//   1. Human submits DASHBOARD_PASSWORD to POST /api/auth/login
//   2. Server compares against env (timing-safe), issues a random
//      256-bit session token, stores SHA-256(token) in dashboard_sessions
//   3. Token rides back to the browser in an HttpOnly cookie — it is
//      never readable by bundle JS, so nothing is baked at build time
//   4. authMiddleware falls back to this cookie when no Bearer header
//      is present, resolving the principal 'dashboard'
//
// Agent bearer auth (src/squad-api/middleware/auth.ts) is untouched:
// Bearer always wins, session is the fallback. DASHBOARD_PASSWORD unset
// ⇒ login returns 503 and the API behaves bearer-only (non-breaking for
// existing dev/test/MCP flows).
// ---------------------------------------------------------------------------

export const SESSION_COOKIE_NAME = 'oh_session'

/** 24h fixed expiry; no sliding renewal in this iteration. */
const SESSION_TTL_MS = 24 * 60 * 60 * 1000

interface DashboardSessionRow {
  principal: string
}

export interface DashboardSession {
  token: string
  expiresAt: Date
}

function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex')
}

/** Constant-time env password check. Empty/missing password always fails. */
export function verifyDashboardPassword(candidate: string | undefined, envPassword: string | undefined): boolean {
  if (!envPassword || envPassword.length === 0) return false
  if (!candidate) return false
  const a = Buffer.from(candidate, 'utf8')
  const b = Buffer.from(envPassword, 'utf8')
  if (a.length !== b.length) {
    // Length mismatch: burn comparable time to blunt length oracles.
    timingSafeEqual(b, b)
    return false
  }
  return timingSafeEqual(a, b)
}

/**
 * Create a session row and return the raw token (only place it exists
 * outside the response cookie).
 */
export async function createDashboardSession(
  pool: Pool,
  opts: { userAgent?: string },
): Promise<DashboardSession> {
  const token = randomBytes(32).toString('hex') // 256-bit
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS)
  await pool.query(
    `INSERT INTO dashboard_sessions (token_hash, principal, user_agent, expires_at)
     VALUES ($1, 'dashboard', $2, $3)`,
    [hashToken(token), opts.userAgent ?? null, expiresAt],
  )
  return { token, expiresAt }
}

/**
 * Resolve a session cookie value to a principal, or null.
 * Expired rows are treated as absent (and opportunistically deleted).
 */
export async function resolveDashboardSession(
  pool: Pool,
  token: string | undefined,
): Promise<string | null> {
  if (!token) return null
  const result = await pool.query<DashboardSessionRow>(
    `UPDATE dashboard_sessions
        SET last_seen_at = now()
      WHERE token_hash = $1
        AND expires_at > now()
      RETURNING principal`,
    [hashToken(token)],
  )
  return result.rows[0]?.principal ?? null
}

/** Invalidate the session for this cookie value (idempotent). */
export async function destroyDashboardSession(pool: Pool, token: string | undefined): Promise<void> {
  if (!token) return
  await pool.query(`DELETE FROM dashboard_sessions WHERE token_hash = $1`, [hashToken(token)])
}

/** Parse the session cookie out of the Cookie header. */
export function parseSessionCookie(req: Request): string | undefined {
  const header = req.headers['cookie']
  if (!header) return undefined
  for (const part of header.split(';')) {
    const eq = part.indexOf('=')
    if (eq === -1) continue
    if (part.slice(0, eq).trim() === SESSION_COOKIE_NAME) {
      return decodeURIComponent(part.slice(eq + 1).trim())
    }
  }
  return undefined
}

export function buildSessionCookie(token: string, expiresAt: Date, secure: boolean): string {
  const flags = [
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Expires=${expiresAt.toUTCString()}`,
  ]
  if (secure) flags.push('Secure')
  return flags.join('; ')
}

export function buildClearSessionCookie(): string {
  return `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Expires=Thu, 01 Jan 1970 00:00:00 GMT`
}

/**
 * Session fallback for authMiddleware: bearer is checked first by the
 * caller; this runs only when no Bearer header was present.
 */
export async function sessionAuthFallback(
  pool: Pool,
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const token = parseSessionCookie(req)
  const principal = await resolveDashboardSession(pool, token)
  if (!principal) {
    res.status(401).json({ error: 'Unauthorized' })
    return
  }
  res.locals['agentSlug'] = principal
  next()
}
