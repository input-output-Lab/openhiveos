import type { Request, Response, NextFunction } from 'express'
import { createHash } from 'node:crypto'
import { compareTokenHash } from '../../auth/token-comparison.js'
import { withReaderRole } from '../db.js'

// ---------------------------------------------------------------------------
// Squad API bearer token auth middleware — ARCH-012 A7 (#1351)
//
// Token format: <32-hex-salt>.<64-hex-secret> (same wire format as MCP server)
// Hash:         SHA-256(salt + secret) — stored in agents.token_hash
// DB role:      openhiveos_reader for the lookup query (SEC-A5)
//
// On success: sets res.locals.agentSlug and calls next()
// On failure: 401 with no token material in the response body (SEC-A6)
//
// Security conditions (Locksmith, ARCH-012):
//   SEC-A5 — openhiveos_reader only — enforced via withReaderRole()
//   SEC-A6 — no token_hash, salt, raw bytes in any response — enforced here
// ---------------------------------------------------------------------------

// Extend Express Request so downstream handlers can read the resolved slug.
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Locals {
      agentSlug: string
    }
  }
}

interface AgentRow {
  slug: string
  token_hash: string
}

const TOKEN_REGEX = /^[\da-f]{32}\.[\da-f]{64}$/i

function parseBearer(header: string | undefined): { salt: string; secret: string } | null {
  if (!header?.startsWith('Bearer ')) return null
  const token = header.slice(7)
  if (!TOKEN_REGEX.test(token)) return null
  const dot = token.indexOf('.')
  return { salt: token.slice(0, dot), secret: token.slice(dot + 1) }
}

function computeHash(salt: string, secret: string): string {
  return createHash('sha256').update(salt + secret).digest('hex')
}

/** Generic 401 — intentionally opaque. No token material returned (SEC-A6). */
function unauthorized(res: Response): void {
  res.status(401).json({ error: 'Unauthorized' })
}

export async function authMiddleware(req: Request, res: Response, next: NextFunction): Promise<void> {
  const parsed = parseBearer(req.headers['authorization'])
  if (!parsed) {
    unauthorized(res)
    return
  }

  const hashHex = computeHash(parsed.salt, parsed.secret)

  let row: AgentRow | undefined
  try {
    row = await withReaderRole(async (client) => {
      const result = await client.query<AgentRow>(
        `SELECT slug, token_hash
           FROM agents
          WHERE token_hash = $1
            AND active = true
          LIMIT 1`,
        [hashHex],
      )
      return result.rows[0]
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[squad-api/auth] DB error during token lookup:', message)
    res.status(500).json({ error: 'Internal server error' })
    return
  }

  if (!row) {
    unauthorized(res)
    return
  }

  // Defence-in-depth: timing-safe comparison via shared token-comparison module (ARCH-008 universal rule).
  // Even though the WHERE clause already matched, verify with constant-time comparison to prevent
  // timing-side-channel attacks on token verification (SEC-A6).
  try {
    if (!compareTokenHash(row.token_hash, hashHex)) {
      unauthorized(res)
      return
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[squad-api/auth] Hash comparison error:', message)
    unauthorized(res)
    return
  }

  // Attach resolved identity for downstream route handlers.
  // Never expose token_hash, salt, or secret downstream.
  res.locals['agentSlug'] = row.slug
  next()
}
