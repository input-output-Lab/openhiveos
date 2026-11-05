/**
 * tests/squad-api/dashboard-session.test.ts
 *
 * S18-SEC-03 (#2642): unit tests for the dashboard session auth module
 * and its integration into authMiddleware + the /api/auth routes.
 *
 * Layer 1 (pure, no DB): password verification (timing-safe), cookie
 * build/parse round-trips.
 *
 * Layer 2 (DB): create → resolve → destroy session lifecycle against a
 * real Postgres (testcontainer via createTestDb). Skips when
 * TEST_DATABASE_URL is absent so the suite stays hermetic (same pattern
 * as tests/squad-api/app.test.ts).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { Request } from 'express'
import {
  verifyDashboardPassword,
  buildSessionCookie,
  buildClearSessionCookie,
  parseSessionCookie,
  SESSION_COOKIE_NAME,
} from '../../src/squad-api/auth/dashboard-session.js'

// ─────────────────────────────────────────────────────────────────────────────
// Layer 1 — password verification
// ─────────────────────────────────────────────────────────────────────────────

describe('verifyDashboardPassword', () => {
  const ENV = 'correct-horse-battery-staple'

  it('accepts the matching password', () => {
    expect(verifyDashboardPassword(ENV, ENV)).toBe(true)
  })

  it('rejects a wrong password', () => {
    expect(verifyDashboardPassword('wrong', ENV)).toBe(false)
  })

  it('rejects when env password is unset or empty (feature off)', () => {
    expect(verifyDashboardPassword(ENV, undefined)).toBe(false)
    expect(verifyDashboardPassword(ENV, '')).toBe(false)
  })

  it('rejects missing candidate', () => {
    expect(verifyDashboardPassword(undefined, ENV)).toBe(false)
  })

  it('rejects different-length candidate without throwing', () => {
    expect(verifyDashboardPassword('short', ENV)).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Layer 1 — cookie helpers
// ─────────────────────────────────────────────────────────────────────────────

describe('session cookie helpers', () => {
  const TOKEN = 'a'.repeat(64)
  const EXPIRES = new Date('2026-12-01T00:00:00.000Z')

  it('builds an HttpOnly SameSite=Lax cookie', () => {
    const cookie = buildSessionCookie(TOKEN, EXPIRES, false)
    expect(cookie).toContain(`${SESSION_COOKIE_NAME}=${TOKEN}`)
    expect(cookie).toContain('HttpOnly')
    expect(cookie).toContain('SameSite=Lax')
    expect(cookie).toContain('Path=/')
    expect(cookie).not.toContain('Secure')
  })

  it('adds Secure in production mode', () => {
    expect(buildSessionCookie(TOKEN, EXPIRES, true)).toContain('Secure')
  })

  it('clear cookie expires in the past', () => {
    expect(buildClearSessionCookie()).toContain('Expires=Thu, 01 Jan 1970')
  })

  function reqWithCookie(cookie: string): Request {
    return { headers: { cookie } } as unknown as Request
  }

  it('parseSessionCookie round-trips the value', () => {
    const req = reqWithCookie(buildSessionCookie(TOKEN, EXPIRES, false))
    expect(parseSessionCookie(req)).toBe(TOKEN)
  })

  it('parseSessionCookie finds the cookie among others', () => {
    const req = reqWithCookie(`other=1; ${SESSION_COOKIE_NAME}=${TOKEN}; third=3`)
    expect(parseSessionCookie(req)).toBe(TOKEN)
  })

  it('parseSessionCookie returns undefined when absent', () => {
    expect(parseSessionCookie(reqWithCookie('other=1'))).toBeUndefined()
    expect(parseSessionCookie({ headers: {} } as unknown as Request)).toBeUndefined()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Layer 2 — DB lifecycle (skipped without TEST_DATABASE_URL)
// ─────────────────────────────────────────────────────────────────────────────

const hasDb = !!process.env['TEST_DATABASE_URL']
describe.skipIf(!hasDb)('dashboard session lifecycle (DB)', () => {
  let db: import('../helpers/db.js').TestDb
  // Lazy — avoids loading the session module's Pool usage in pure mode.
  let createDashboardSession: typeof import('../../src/squad-api/auth/dashboard-session.js').createDashboardSession
  let resolveDashboardSession: typeof import('../../src/squad-api/auth/dashboard-session.js').resolveDashboardSession
  let destroyDashboardSession: typeof import('../../src/squad-api/auth/dashboard-session.js').destroyDashboardSession

  beforeAll(async () => {
    const mod = await import('../../src/squad-api/auth/dashboard-session.js')
    createDashboardSession = mod.createDashboardSession
    resolveDashboardSession = mod.resolveDashboardSession
    destroyDashboardSession = mod.destroyDashboardSession
    const { createTestDb } = await import('../helpers/db.js')
    db = await createTestDb()
  }, 90_000)

  afterAll(async () => {
    if (db) await db.teardown()
  })

  it('create → resolve → destroy round-trip', async () => {
    const { token, expiresAt } = await createDashboardSession(db.pool, { userAgent: 'vitest' })
    expect(token).toHaveLength(64)
    expect(expiresAt.getTime()).toBeGreaterThan(Date.now())

    const principal = await resolveDashboardSession(db.pool, token)
    expect(principal).toBe('dashboard')

    await destroyDashboardSession(db.pool, token)
    expect(await resolveDashboardSession(db.pool, token)).toBeNull()
  })

  it('unknown token resolves to null (no throw)', async () => {
    expect(await resolveDashboardSession(db.pool, 'f'.repeat(64))).toBeNull()
    expect(await resolveDashboardSession(db.pool, undefined)).toBeNull()
  })

  it('destroy is idempotent for unknown tokens', async () => {
    await expect(destroyDashboardSession(db.pool, undefined)).resolves.toBeUndefined()
    await expect(destroyDashboardSession(db.pool, 'e'.repeat(64))).resolves.toBeUndefined()
  })
})
